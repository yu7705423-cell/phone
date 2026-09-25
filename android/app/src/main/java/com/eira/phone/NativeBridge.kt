package com.eira.phone

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * 网页那头的 EiraNative（见 assets/bridge.js）。
 *
 * 一、替网页发请求。跨域是浏览器的规矩：很多语音、生图接口没考虑过浏览器直连，
 *    网页里连不上，用系统自己的网络栈发同样的请求就通。与 ios/Sources/NetBridge.swift 同一个约定：
 *    只做转发，状态码、响应头、响应体原样交回，错误也原样报。
 * 二、把网页导出的文件（备份）写进系统的「下载」。
 * 三、通话的桌面悬浮窗（见 CallFloat 与网页的 src/system/callfloat.js）。
 */
class NativeBridge(private val context: Context, private val web: WebView) {

    private val pool = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun version(): String = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    @JavascriptInterface
    fun post(name: String, id: Int, json: String) {
        pool.execute {
            val reply = try {
                val msg = JSONObject(json)
                when {
                    name == "net" && msg.optString("action") == "fetch" -> fetch(msg)
                    else -> JSONObject().put("error", "不认识的动作")
                }
            } catch (e: Throwable) {
                JSONObject().put("error", e.message ?: e.toString())
            }
            val text = JSONObject.quote(reply.toString())
            main.post { web.evaluateJavascript("window.__eiraReply && window.__eiraReply($id, $text)", null) }
        }
    }

    // ---- 通话的桌面悬浮窗 ----

    /** 系统给没给「显示在其他应用上层」 */
    @JavascriptInterface
    fun floatAllowed(): Boolean = CallFloat.allowed(context)

    /** 带人去系统设置里给这个权限。给不给由人决定，回来之后网页再问一次 floatAllowed */
    @JavascriptInterface
    fun askFloat() {
        main.post {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(intent) }
        }
    }

    /** 网页按时交过来的通话状态：{ on, title, status, line, image? } */
    @JavascriptInterface
    fun setFloat(json: String) {
        val msg = runCatching { JSONObject(json) }.getOrNull() ?: return
        main.post { CallFloat.update(context, msg) }
    }

    // ---- 发请求 ----

    private fun fetch(msg: JSONObject): JSONObject {
        val url = msg.optString("url")
        val method = msg.optString("method", "GET").uppercase()
        // 网页按接口给一个期限（秒）。生图一张跑一两分钟是常事，默认给足
        val seconds = msg.optDouble("timeout", DEFAULT_TIMEOUT).let { if (it > 0) it else DEFAULT_TIMEOUT }
        if (method == "PATCH") return JSONObject().put("error", "安卓外壳发不了 PATCH 请求")
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = minOf(30_000, (seconds * 1000).toInt())
            conn.readTimeout = (seconds * 1000).toInt()
            conn.instanceFollowRedirects = true
            msg.optJSONObject("headers")?.let { h ->
                h.keys().forEach { k -> conn.setRequestProperty(k, h.optString(k)) }
            }
            val body = msg.optString("body", "")
            if (body.isNotEmpty() && method != "GET" && method != "HEAD") {
                val bytes = Base64.decode(body, Base64.DEFAULT)
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val data = stream?.use { readCapped(it) } ?: ByteArray(0)
            val headers = JSONObject()
            conn.headerFields.forEach { (k, v) -> if (k != null) headers.put(k.lowercase(), v.joinToString(", ")) }
            return JSONObject()
                .put("status", status)
                .put("headers", headers)
                .put("body", Base64.encodeToString(data, Base64.NO_WRAP))
        } catch (e: SocketTimeoutException) {
            return JSONObject().put("error", "请求超时").put("timedOut", true).put("seconds", seconds)
        } finally {
            conn.disconnect()
        }
    }

    // 太大的不接：回包是一个 JS 字符串，几十兆的 base64 会把内存顶穿
    private fun readCapped(input: InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > MAX_BYTES) throw IllegalStateException("回来的内容太大（超过 ${MAX_BYTES / 1024 / 1024} MB），这一层转不过去")
        }
        return out.toByteArray()
    }

    // ---- 保存文件 ----

    private class Sink(val out: OutputStream, val uri: Uri?, val name: String, val where: String)
    private val sinks = ConcurrentHashMap<Int, Sink>()
    private val seq = AtomicInteger(0)

    /** 开一个文件。给回编号，失败给 0 */
    @JavascriptInterface
    fun beginSave(name: String, mime: String): Int = try {
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "download" }
        val id = seq.incrementAndGet()
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, safe)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("无法在「下载」中新建文件")
            val out = context.contentResolver.openOutputStream(uri) ?: throw IllegalStateException("无法写入「下载」")
            sinks[id] = Sink(out, uri, safe, "下载")
        } else {
            // 安卓 9 及以下写进应用自己的目录，不需要存储权限
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
            val file = File(dir, safe)
            sinks[id] = Sink(FileOutputStream(file), null, safe, file.parent ?: "应用目录")
        }
        id
    } catch (e: Throwable) {
        toast("保存失败：${e.message ?: e}")
        0
    }

    @JavascriptInterface
    fun appendSave(id: Int, b64: String): Boolean {
        val s = sinks[id] ?: return false
        return try {
            s.out.write(Base64.decode(b64, Base64.DEFAULT))
            true
        } catch (e: Throwable) {
            sinks.remove(id)
            runCatching { s.out.close() }
            toast("保存失败：${e.message ?: e}")
            false
        }
    }

    @JavascriptInterface
    fun endSave(id: Int) {
        val s = sinks.remove(id) ?: return
        runCatching { s.out.close() }
        if (s.uri != null && Build.VERSION.SDK_INT >= 29) {
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            runCatching { context.contentResolver.update(s.uri, done, null, null) }
        }
        toast("已保存到「${s.where}」：${s.name}")
    }

    @JavascriptInterface
    fun saveFailed(message: String) = toast("保存失败：$message")

    private fun toast(text: String) = main.post { Toast.makeText(context, text, Toast.LENGTH_LONG).show() }

    companion object {
        private const val DEFAULT_TIMEOUT = 300.0
        private const val MAX_BYTES = 24 * 1024 * 1024
    }
}
