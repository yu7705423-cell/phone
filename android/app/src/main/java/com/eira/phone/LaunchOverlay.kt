package com.eira.phone

import android.content.Context
import android.graphics.Color
import android.graphics.Outline
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * 网页画出第一帧之前盖在上面的一页：图标、一个转圈，必要时一行说明（同 ios/Sources/LaunchView.swift）。
 *
 * 首次打开时，有的系统会先问「是否允许联网」，那一下请求必然失败。从前的外壳（iOS 那边）
 * 在弹窗后面就已经是一整页「无法载入」加一串网址 —— 这里网络没好就停在这一页上等，
 * 网络一通由外壳自己重新载入，这一页上不出现网址。真正载不进来（不是网络的问题）才换成失败的样子，
 * 给「重新载入」与「设置站点地址」。
 */
class LaunchOverlay(context: Context) : FrameLayout(context) {

    private val spinner = ProgressBar(context)
    private val status = TextView(context)
    private val title = TextView(context)
    private val retry = Button(context)
    private val setUrl = Button(context)

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

    init {
        setBackgroundColor(Color.parseColor("#F2F3F5"))
        // 盖着的时候吃掉所有触摸，不让点穿到底下的网页
        isClickable = true

        val icon = ImageView(context).apply {
            setImageResource(R.drawable.launch_icon)
            scaleType = ImageView.ScaleType.CENTER_CROP
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setRoundRect(0, 0, view.width, view.height, dp(22f))
                }
            }
            clipToOutline = true
        }

        title.apply {
            setTextColor(Color.parseColor("#1A1B1E"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            visibility = GONE
        }
        status.apply {
            setTextColor(Color.parseColor("#80838A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.3f)
            visibility = GONE
        }
        retry.apply { text = "重新载入"; isAllCaps = false; visibility = GONE }
        setUrl.apply { text = "设置站点地址"; isAllCaps = false; visibility = GONE }

        val box = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val iconSize = dp(96f).toInt()
            addView(icon, LinearLayout.LayoutParams(iconSize, iconSize))
            val gap = { v: View, top: Float, w: Int -> addView(v, LinearLayout.LayoutParams(w, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top).toInt() }) }
            val wrap = LinearLayout.LayoutParams.WRAP_CONTENT
            val full = LinearLayout.LayoutParams.MATCH_PARENT
            gap(title, 20f, wrap)
            gap(spinner, 20f, wrap)
            gap(status, 16f, full)
            gap(retry, 24f, full)
            gap(setUrl, 8f, full)
        }
        val side = dp(40f).toInt()
        addView(box, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply {
            leftMargin = side; rightMargin = side; bottomMargin = dp(48f).toInt()
        })
    }

    /** 等着：转圈，下面一行说明（null 不显示） */
    fun waiting(text: String?) {
        title.visibility = GONE
        spinner.visibility = VISIBLE
        status.text = text ?: ""
        status.visibility = if (text.isNullOrEmpty()) GONE else VISIBLE
        retry.visibility = GONE
        setUrl.visibility = GONE
    }

    /** 载不进来：写明原因，给两个按钮 */
    fun failed(text: String, onRetry: () -> Unit, onSetUrl: () -> Unit) {
        title.text = "无法载入"
        title.visibility = VISIBLE
        spinner.visibility = GONE
        status.text = text
        status.visibility = VISIBLE
        retry.setOnClickListener { onRetry() }
        setUrl.setOnClickListener { onSetUrl() }
        retry.visibility = VISIBLE
        setUrl.visibility = VISIBLE
    }
}
