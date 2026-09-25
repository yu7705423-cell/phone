package com.eira.phone

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * 整只 app 就是一个铺满屏幕的 WebView，内容从远端地址取（同 ios/）。
 * 改了网页代码不必重新打包安装：网页自己会检查版本并更新。
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var overlay: LaunchOverlay
    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("shell", MODE_PRIVATE) }

    /** 在「设置站点地址」里改过就用改过的，否则用打包时写进去的那个 */
    private val siteUrl: String
        get() = prefs.getString("siteURL", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SITE_URL

    private val bridgeJs by lazy { assets.open("bridge.js").bufferedReader().use { it.readText() } }
    private val docStart by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) }

    // ---- 等网络（同 ios/Sources/ShellViewController.swift）----
    // 断网、联网权限还没给这类失败不报错，停在启动页上等：网络一通就重试，另按 1、2、4、8 秒退避重试。
    // 网络是通的却一直连不上，等满 WAIT_LIMIT 再报失败。
    private var online = true
    private var waiting = false
    private var waitSince = 0L
    private var retryDelay = 1000L
    private var mainFrameFailed = false
    private val retryRun = Runnable { if (waiting) load() }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var permissionRequest: PermissionRequest? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = r.data
        val uris: Array<Uri>? = if (r.resultCode != RESULT_OK || data == null) null else {
            data.clipData?.let { c -> Array(c.itemCount) { c.getItemAt(it).uri } } ?: data.data?.let { arrayOf(it) }
        }
        cb.onReceiveValue(uris)
    }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        permissionRequest?.let { grantWhatWeHave(it) }
        permissionRequest = null
        geoCallback?.invoke(geoOrigin, has(Manifest.permission.ACCESS_COARSE_LOCATION), false)
        geoCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 全屏：藏起系统状态栏，从顶端开始就是页面（网页自己画时间与电量，见 bridge.js 的 phoneFullscreen）。
        // 从屏幕顶端往下划可以临时叫出系统状态栏。底部导航条照留，免得和页面底部的按钮抢手势
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.statusBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            // 系统字体调大了也不跟着放大：界面是按固定尺寸排的，放大就挤乱
            settings.textZoom = 100
            settings.setGeolocationEnabled(true)
            settings.userAgentString = "${settings.userAgentString} EiraAndroid/${BuildConfig.VERSION_NAME}"
            setBackgroundColor(0xFFF2F3F5.toInt())
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.addJavascriptInterface(NativeBridge(this, web), "EiraNative")
        if (docStart) WebViewCompat.addDocumentStartJavaScript(web, bridgeJs, setOf("*"))
        web.webViewClient = ShellClient()
        web.webChromeClient = ShellChrome()

        overlay = LaunchOverlay(this)
        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        watchNetwork()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })
        load()
    }

    // 通话的桌面悬浮窗只在 Eira 退到后台时出现（见 CallFloat）
    override fun onStart() {
        super.onStart()
        CallFloat.setBackground(this, false)
    }

    override fun onStop() {
        CallFloat.setBackground(this, true)
        super.onStop()
    }

    override fun onDestroy() {
        CallFloat.hide(this)
        main.removeCallbacks(retryRun)
        web.destroy()
        super.onDestroy()
    }

    // ---- 载入 ----

    private fun load() {
        main.removeCallbacks(retryRun)
        overlay.visibility = View.VISIBLE
        overlay.waiting(if (waiting) waitText() else null)
        mainFrameFailed = false
        web.loadUrl(siteUrl)
    }

    private fun reveal() {
        stopWaiting()
        if (overlay.visibility != View.VISIBLE) return
        overlay.animate().alpha(0f).setDuration(200).withEndAction {
            overlay.visibility = View.GONE
            overlay.alpha = 1f
        }.start()
    }

    private fun fail(text: String) {
        stopWaiting()
        overlay.animate().cancel()
        overlay.alpha = 1f
        overlay.visibility = View.VISIBLE
        overlay.failed(text, onRetry = { load() }, onSetUrl = { promptForUrl() })
    }

    private fun promptForUrl() {
        val input = EditText(this).apply {
            setText(siteUrl)
            setSingleLine()
        }
        AlertDialog.Builder(this)
            .setTitle("站点地址")
            .setMessage("Eira 网页的地址。留空则恢复为打包时的地址。")
            .setView(input)
            .setPositiveButton("保存并载入") { _, _ ->
                prefs.edit().putString("siteURL", input.text.toString().trim()).apply()
                load()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    // ---- 等网络 ----

    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        online = cm.activeNetwork != null
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post {
                    online = true
                    // 网络刚通（包括刚允许了联网）：马上重试，不等退避
                    if (waiting) { retryDelay = 1000L; load() }
                }
            }
            override fun onLost(network: Network) {
                main.post {
                    online = cm.activeNetwork != null
                    if (waiting) overlay.waiting(waitText())
                }
            }
        })
    }

    private fun waitForNetwork(description: String) {
        if (!waiting) { waiting = true; waitSince = System.currentTimeMillis() }
        if (online && System.currentTimeMillis() - waitSince > WAIT_LIMIT) {
            fail("暂时连接不上。请检查网络后重新载入。\n$description")
            return
        }
        overlay.visibility = View.VISIBLE
        overlay.waiting(waitText())
        main.removeCallbacks(retryRun)
        main.postDelayed(retryRun, retryDelay)
        retryDelay = minOf(retryDelay * 2, 8000L)
    }

    private fun stopWaiting() {
        waiting = false
        retryDelay = 1000L
        main.removeCallbacks(retryRun)
    }

    private fun waitText() = if (!online) "等待网络连接。若系统询问是否允许 Eira 联网，请选择允许。" else "正在连接"

    // ---- 返回键 ----
    // 交给网页（shell/goback.js）：它退一级给 true；已经在桌面或锁屏、无处可退给 false，这时把应用切到后台
    private fun goBack() {
        if (overlay.visibility == View.VISIBLE) { moveTaskToBack(true); return }
        web.evaluateJavascript("(function(){try{return window.phoneBack?window.phoneBack()!==false:false}catch(e){return false}})()") { r ->
            if (r != "true") moveTaskToBack(true)
        }
    }

    // ---- 权限 ----

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun grantWhatWeHave(req: PermissionRequest) {
        val ok = req.resources.filter {
            when (it) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> has(Manifest.permission.RECORD_AUDIO)
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> has(Manifest.permission.CAMERA)
                else -> false
            }
        }
        if (ok.isEmpty()) req.deny() else req.grant(ok.toTypedArray())
    }

    // ---- WebView 回调 ----

    private inner class ShellClient : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // 老一点的 WebView 不支持在文档一开始注入，退而求其次在这里注入
            if (!docStart) view.evaluateJavascript(bridgeJs, null)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!mainFrameFailed) reveal()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            mainFrameFailed = true
            val code = error.errorCode
            val desc = error.description?.toString() ?: ""
            if (code in NETWORK_ERRORS) waitForNetwork(desc) else fail(desc)
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (!request.isForMainFrame) return
            mainFrameFailed = true
            fail("站点返回了 ${response.statusCode}。")
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val scheme = url.scheme?.lowercase() ?: ""
            val siteHost = Uri.parse(siteUrl).host?.lowercase()
            if ((scheme == "http" || scheme == "https") && url.host?.lowercase() == siteHost) return false
            // 站外链接（充值页、网易云……）与 mailto、tel 这类交给系统
            try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: ActivityNotFoundException) { }
            return true
        }

        // 网页进程没了（系统回收）：重载，不然是一张白纸
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recreate()
            return true
        }
    }

    private inner class ShellChrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val intent = params.createIntent().apply {
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            return try {
                pickFiles.launch(intent)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }

        // 录语音、通话要麦克风
        override fun onPermissionRequest(request: PermissionRequest) {
            main.post {
                val need = request.resources.mapNotNull {
                    when (it) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        else -> null
                    }
                }.filter { !has(it) }
                if (need.isEmpty()) grantWhatWeHave(request)
                else { permissionRequest = request; askPermissions.launch(need.toTypedArray()) }
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (has(Manifest.permission.ACCESS_COARSE_LOCATION)) { callback.invoke(origin, true, false); return }
            geoOrigin = origin
            geoCallback = callback
            askPermissions.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }

    companion object {
        private const val WAIT_LIMIT = 20_000L
        // 断网、找不到主机、连不上、超时、读写中断 —— 这几种等一等就会好
        private val NETWORK_ERRORS = setOf(
            WebViewClient.ERROR_HOST_LOOKUP, WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_TIMEOUT,
            WebViewClient.ERROR_IO, WebViewClient.ERROR_UNKNOWN,
        )
    }
}
