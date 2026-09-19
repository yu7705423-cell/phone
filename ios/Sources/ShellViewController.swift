import UIKit
import WebKit
import AVFoundation

/// 整只 app 就是一个铺满屏幕的 WKWebView，内容从远端地址取。
///
/// 站点不打进包里：改了网页代码，在 app 里摇一摇重新载入就是新的，不必重新打包安装。
/// 代价是首次打开与刷新都需要网络 —— 本项目的 Service Worker 只负责通知，不缓存任何资源，
/// 所以打成包也同样离线打不开，这里没有额外损失。
final class ShellViewController: UIViewController {

    private static let urlKey = "siteURL"

    private var web: WKWebView!
    private var failure: FailureView?
    /// 每个下载存到哪儿。Progress 上那个 fileURL 不保证有值，自己记一份稳当些。
    private var downloadPaths: [ObjectIdentifier: URL] = [:]

    // MARK: - 站点地址

    /// 用户在外壳菜单里改过就用用户填的，否则用打包时写进 Info.plist 的那个。
    static var siteURLString: String {
        let saved = UserDefaults.standard.string(forKey: urlKey) ?? ""
        if !saved.isEmpty { return saved }
        return Bundle.main.object(forInfoDictionaryKey: "PhoneSiteURL") as? String ?? ""
    }

    private var siteURL: URL? {
        let s = Self.siteURLString
        return s.isEmpty ? nil : URL(string: s)
    }

    /// 打包时写进 Info.plist 的 app-bound 域名。
    ///
    /// 这份名单不是可有可无的：站点不在名单里，WebKit 会按「七天未访问就清掉可写存储」
    /// 处理它，IndexedDB 里的全部角色卡与聊天记录都会被清掉。名单里的域名不受这条约束。
    /// 代价是这个 WebView 只能在名单内的域名之间跳转，所以用户改到别的地址时，
    /// 下面会退回普通模式 —— 能用，但不再有这层保护。
    private static var appBoundDomains: [String] {
        (Bundle.main.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String] ?? [])
            .map { $0.lowercased() }
    }

    private static func isAppBound(_ url: URL?) -> Bool {
        // app-bound 只对 https 生效。指着局域网里 http 的静态服务器时不能开，
        // 开了那一次载入会被 WebKit 直接拦掉
        guard url?.scheme?.lowercased() == "https", let host = url?.host?.lowercased() else { return false }
        return appBoundDomains.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    // MARK: - 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        configureAudioSession()
        buildWebView()
        load()
        NotificationCenter.default.addObserver(
            self, selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override var canBecomeFirstResponder: Bool { true }

    override var preferredStatusBarStyle: UIStatusBarStyle { .default }

    /// 摇一摇打开外壳菜单。外壳只有这一个入口，其余一切都归网页管。
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        guard motion == .motionShake else { return }
        presentShellMenu()
    }

    @objc private func didBecomeActive() {
        // 上次没载进来（断网、地址写错）时回到前台再试一次，不然要一直看着失败页
        if web.url == nil { load() }
    }

    // MARK: - WebView

    private func buildWebView() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                   // 持久化。IndexedDB 存在这里
        cfg.allowsInlineMediaPlayback = true
        cfg.allowsAirPlayForMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []   // 保活那段无声音频要能自己播
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.limitsNavigationsToAppBoundDomains = Self.isAppBound(siteURL)
        if #available(iOS 15.4, *) {
            cfg.preferences.isElementFullscreenEnabled = true   // 读书与看片的全屏靠它
        }

        let w = WKWebView(frame: view.bounds, configuration: cfg)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.allowsBackForwardNavigationGestures = false
        w.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        w.isOpaque = false
        w.backgroundColor = .clear
        // 不替页面调整内边距。页面自己用 env(safe-area-inset-*) 避开刘海与 Home Indicator，
        // 这里再插一手就成了两层，底下会空出一条
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        w.scrollView.showsVerticalScrollIndicator = false
        w.scrollView.pinchGestureRecognizer?.isEnabled = false
        view.addSubview(w)
        web = w
    }

    private func load() {
        hideFailure()
        guard let url = siteURL else {
            showFailure("尚未设置站点地址。摇动设备打开菜单，选择「设置站点地址」。")
            return
        }
        var req = URLRequest(url: url)
        // 每次载入都回源问一遍。改了网页代码，刷新就能拿到新的
        req.cachePolicy = .reloadRevalidatingCacheData
        web.load(req)
    }

    /// 音频会话。网页那段无声循环音频要靠它在后台继续跑，主动消息的定时器才有机会照常触发。
    /// 用 mixWithOthers，不打断用户自己在放的东西。
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
    }

    // MARK: - 外壳菜单

    private func presentShellMenu() {
        guard presentedViewController == nil else { return }
        let sheet = UIAlertController(title: "外壳设置", message: Self.siteURLString,
                                      preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "重新载入", style: .default) { [weak self] _ in
            self?.load()
        })
        sheet.addAction(UIAlertAction(title: "清除网页缓存后载入", style: .default) { [weak self] _ in
            self?.clearCacheAndReload()
        })
        sheet.addAction(UIAlertAction(title: "设置站点地址", style: .default) { [weak self] _ in
            self?.promptForURL()
        })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel))
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect =
            CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(sheet, animated: true)
    }

    /// 只清 HTTP 缓存，不动 IndexedDB 与 localStorage。角色卡与聊天记录都在后者里。
    private func clearCacheAndReload() {
        let types: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
        WKWebsiteDataStore.default().removeData(
            ofTypes: types, modifiedSince: .distantPast
        ) { [weak self] in
            self?.load()
        }
    }

    private func promptForURL() {
        let alert = UIAlertController(
            title: "站点地址",
            message: "填写网页所在的地址。保存后重新载入。",
            preferredStyle: .alert)
        alert.addTextField { f in
            f.text = Self.siteURLString
            f.keyboardType = .URL
            f.autocapitalizationType = .none
            f.autocorrectionType = .no
            f.clearButtonMode = .whileEditing
        }
        alert.addAction(UIAlertAction(title: "保存", style: .default) { [weak self] _ in
            let text = (alert.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespaces)
            UserDefaults.standard.set(text, forKey: Self.urlKey)
            self?.rebuildAndLoad()
        })
        alert.addAction(UIAlertAction(title: "恢复为打包时的地址", style: .destructive) { [weak self] _ in
            UserDefaults.standard.removeObject(forKey: Self.urlKey)
            self?.rebuildAndLoad()
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    /// 换了地址就得重建 WebView：app-bound 是创建时定死的，改不了。
    private func rebuildAndLoad() {
        let wasAppBound = web.configuration.limitsNavigationsToAppBoundDomains
        let nowAppBound = Self.isAppBound(siteURL)
        web.removeFromSuperview()
        buildWebView()
        load()
        if wasAppBound && !nowAppBound {
            showNote("新地址不在打包时写入的域名清单内，数据保护已关闭。"
                     + "系统可能在长期未打开后清除本机数据，请定期导出备份。")
        }
    }

    private func showNote(_ text: String) {
        let alert = UIAlertController(title: "提示", message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    // MARK: - 失败页

    private func showFailure(_ text: String) {
        hideFailure()
        let v = FailureView(
            message: text,
            onRetry: { [weak self] in self?.load() },
            onSettings: { [weak self] in self?.presentShellMenu() })
        v.frame = view.bounds
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(v)
        failure = v
    }

    private func hideFailure() {
        failure?.removeFromSuperview()
        failure = nil
    }
}

// MARK: - 导航

extension ShellViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 带 download 属性的链接。导出备份走的就是这条，不接住的话点了没反应
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        let url = navigationAction.request.url
        let scheme = url?.scheme?.lowercased() ?? ""
        // 站外链接交给系统，不在这只 app 里打开
        if navigationAction.navigationType == .linkActivated,
           ["http", "https"].contains(scheme),
           url?.host?.lowercased() != siteURL?.host?.lowercased() {
            decisionHandler(.cancel)
            if let url { UIApplication.shared.open(url) }
            return
        }
        // mailto、tel 这类交给系统
        if !["http", "https", "about", "data", "blob", "file"].contains(scheme), let url {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hideFailure()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reportFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reportFailure(error)
    }

    private func reportFailure(_ error: Error) {
        let e = error as NSError
        // 自己发起的取消不算失败：换地址时旧的那次载入就会走到这里
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        showFailure("无法载入 \(Self.siteURLString)。\n\(e.localizedDescription)")
    }
}

// MARK: - 下载

extension ShellViewController: WKDownloadDelegate {

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let dest = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        downloadPaths[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadPaths.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // 存到哪儿由用户决定：分享面板里有「存储到文件」
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect =
            CGRect(x: view.bounds.midX, y: view.bounds.maxY, width: 1, height: 1)
        present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadPaths.removeValue(forKey: ObjectIdentifier(download))
        showNote("下载失败。\(error.localizedDescription)")
    }
}

// MARK: - 弹窗与新窗口

extension ShellViewController: WKUIDelegate {

    /// target=_blank 一律在当前 WebView 里打开，不另开一只
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if url.host?.lowercased() == siteURL?.host?.lowercased() {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in
            completionHandler(a.textFields?.first?.text)
        })
        present(a, animated: true)
    }
}
