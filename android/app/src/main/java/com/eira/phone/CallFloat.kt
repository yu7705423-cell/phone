package com.eira.phone

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.text.TextUtils
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
import org.json.JSONObject
import kotlin.math.abs

/**
 * 通话的桌面悬浮窗（网页那头见 src/system/callfloat.js）。
 *
 * 网页只管按时把「谁、通了多久、刚说到哪句」交过来（setFloat）；这里决定什么时候画：
 * **只在 Eira 退到后台时出现**，回到 Eira 就收起 —— 应用里有自己的悬浮球，两个叠着没有意义。
 *
 * 要「显示在其他应用上层」权限（SYSTEM_ALERT_WINDOW）。没给就什么都不画，网页那边会先把人带去系统设置。
 * 点一下回到 Eira；按住可以拖，松手贴到近的那一边。
 */
object CallFloat {

    private var on = false
    private var title = ""
    private var status = ""
    private var line = ""
    private var image: android.graphics.Bitmap? = null
    private var inBackground = false

    private var view: LinearLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var face: ImageView? = null
    private var titleView: TextView? = null
    private var statusView: TextView? = null
    private var lineView: TextView? = null

    fun allowed(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    /** 网页交过来的一份状态。on=false 就撤掉 */
    fun update(ctx: Context, msg: JSONObject) {
        on = msg.optBoolean("on", false)
        if (!on) { hide(ctx); image = null; return }
        title = msg.optString("title", title)
        status = msg.optString("status", status)
        line = msg.optString("line", line)
        if (msg.has("image")) image = decode(msg.optString("image", ""))
        refresh(ctx)
    }

    /** MainActivity 的 onStart / onStop */
    fun setBackground(ctx: Context, inBackground: Boolean) {
        this.inBackground = inBackground
        refresh(ctx)
    }

    private fun refresh(ctx: Context) {
        if (!on || !inBackground || !allowed(ctx)) { hide(ctx); return }
        if (view == null) show(ctx)
        paint()
    }

    private fun decode(dataUrl: String): android.graphics.Bitmap? {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || comma < 0) return null
        return try {
            val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Throwable) { null }
    }

    private fun dp(ctx: Context, v: Float): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).toInt()

    private fun paint() {
        val v = view ?: return
        titleView?.text = title
        statusView?.text = status
        // 字幕往后长，小窗里只留最新的那一截
        lineView?.text = if (line.length > 40) "…" + line.takeLast(40) else line
        lineView?.visibility = if (line.isBlank()) View.GONE else View.VISIBLE
        val bmp = image
        val img = face ?: return
        if (bmp != null) {
            img.setImageDrawable(RoundedBitmapDrawableFactory.create(v.resources, bmp).apply { isCircular = true })
            img.visibility = View.VISIBLE
        } else {
            img.visibility = View.GONE
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun show(ctx: Context) {
        val app = ctx.applicationContext
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = app.resources.displayMetrics
        val width = dp(app, 228f)

        val card = LinearLayout(app).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(app, 10f), dp(app, 10f), dp(app, 12f), dp(app, 10f))
            background = GradientDrawable().apply {
                cornerRadius = dp(app, 18f).toFloat()
                setColor(0xFFFFFFFF.toInt())
            }
            elevation = dp(app, 8f).toFloat()
        }
        val img = ImageView(app).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        val size = dp(app, 44f)
        card.addView(img, LinearLayout.LayoutParams(size, size).apply { marginEnd = dp(app, 10f) })

        val col = LinearLayout(app).apply { orientation = LinearLayout.VERTICAL }
        val t = TextView(app).apply {
            setTextColor(0xFF000000.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD; maxLines = 1; ellipsize = TextUtils.TruncateAt.END
        }
        val s = TextView(app).apply {
            setTextColor(0xFF8A8A8A.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f); maxLines = 1
        }
        val l = TextView(app).apply {
            setTextColor(0xFF333333.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            maxLines = 2; ellipsize = TextUtils.TruncateAt.END
        }
        col.addView(t); col.addView(s); col.addView(l)
        card.addView(col, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // minSdk 是 26，TYPE_APPLICATION_OVERLAY 一定有
        val type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        val lp = WindowManager.LayoutParams(
            width, WindowManager.LayoutParams.WRAP_CONTENT, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = lastX ?: (metrics.widthPixels - width - dp(app, 12f))
            y = lastY ?: dp(app, 160f)
        }

        // 拖动与点击
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        card.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (!moved && abs(dx) < dp(app, 6f) && abs(dy) < dp(app, 6f)) return@setOnTouchListener true
                    moved = true
                    lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt()
                    runCatching { wm.updateViewLayout(v, lp) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) { open(app); return@setOnTouchListener true }
                    // 贴到近的那一边
                    val w = v.width
                    lp.x = if (lp.x + w / 2 < metrics.widthPixels / 2) dp(app, 12f) else metrics.widthPixels - w - dp(app, 12f)
                    lp.y = lp.y.coerceIn(dp(app, 24f), metrics.heightPixels - v.height - dp(app, 48f))
                    lastX = lp.x; lastY = lp.y
                    runCatching { wm.updateViewLayout(v, lp) }
                    true
                }
                else -> false
            }
        }

        try {
            wm.addView(card, lp)
        } catch (_: Throwable) {
            return
        }
        view = card; params = lp; face = img; titleView = t; statusView = s; lineView = l
    }

    private var lastX: Int? = null
    private var lastY: Int? = null

    fun hide(ctx: Context) {
        val v = view ?: return
        val wm = ctx.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        runCatching { wm.removeView(v) }
        view = null; params = null; face = null; titleView = null; statusView = null; lineView = null
    }

    // 回到 Eira。有「显示在其他应用上层」权限的应用可以从后台把自己拉到前面
    private fun open(ctx: Context) {
        val intent = Intent(ctx, MainActivity::class.java).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
        runCatching { ctx.startActivity(intent) }
    }
}
