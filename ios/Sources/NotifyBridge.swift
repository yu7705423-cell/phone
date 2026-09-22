import Foundation
import UserNotifications
import WebKit

// 系统通知。
//
// **网页在这里要不到。** WKWebView 没有 Notification，也没有 Service Worker 的
// showNotification —— 那两样在 iOS 上只给 Safari 和「添加到主屏幕」的 PWA。
// 装成 app 之后网页那套一律报「这个浏览器不支持」，于是通知整个没了。
//
// 所以由这一层发。用的是**本地通知**（UNUserNotificationCenter），
// 不是 Web Push：
//
//   - **不需要任何 entitlement。** 和 HealthKit 不一样，各人怎么签都发得出来。
//   - 不需要服务器。网页那边算出「该提醒了」就叫这里发一条。
//   - 代价是 app 被系统彻底结束之后就没人算了。真要那种，仍然得有台服务器。
//
// 点开通知回到哪儿由网页决定：这里把 route 与 appId 原样带回去交给
// window.phoneNotifyOpen，和网页自己那条点击回跳走同一个出口。

final class NotifyBridge: NSObject {

    private let center = UNUserNotificationCenter.current()
    /// 回调网页用。ShellViewController 建好 WKWebView 之后塞进来
    weak var web: WKWebView? { didSet { flush() } }

    /// 还没交出去的那一下。
    ///
    /// **点通知这件事几乎总是跑在网页前面。** app 被系统结束之后再点，
    /// 顺序是：先启动、建 WKWebView、开始载入，然后系统才把这一下交过来 ——
    /// 那时页面还在载，evaluateJavaScript 打在一个马上就要被换掉的文档上，
    /// 等于没打。从后台回来也一样：网页进程被回收过就要重载一遍。
    ///
    /// 所以这里先记着，等页面真的载完了（ShellViewController 的 didFinish）
    /// 再交。网页那头 index.html 在文档一开始就挂了一个接得住的
    /// phoneNotifyOpen，起来之后自己去兑现（见 system/push.js）。
    private var pending: String?

    /// 页面不在了的时候叫外壳重载。ShellViewController 建好之后塞进来。
    ///
    /// 两种「不在了」：进程被系统回收（evaluateJavaScript 抛错）；进程回收之后
    /// 被重新拉起来、但拉起来的是一张空文档（url 还在，isLoading 也是 false，
    /// 只是上面什么都没有 —— 网页那头的 phoneNotifyOpen 不存在，问下去回的是
    /// undefined 而不是 true）。第二种从外面什么都看不出来，只有这一问问得出来。
    var reload: (() -> Void)?
    /// 同一下点击最多因为「交不出去」重载几次。站点真坏了不能没完没了地转
    private var reloads = 0
    private static let maxReloads = 2

    override init() {
        super.init()
        center.delegate = self
    }

    // MARK: - 三个动作

    private func status() async -> [String: Any] {
        let s = await center.notificationSettings()
        switch s.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return ["permission": "granted"]
        case .denied: return ["permission": "denied"]
        default: return ["permission": "default"]
        }
    }

    private func request() async -> [String: Any] {
        do {
            let got = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            // 用户在系统那张表上点了「不允许」，这不是错误，如实回去
            return got ? ["permission": "granted"] : ["permission": "denied"]
        } catch {
            return ["error": "系统没有授权：\(error.localizedDescription)"]
        }
    }

    /// 立刻发一条。tag 当标识符：同一个 tag 会顶掉前一条，这一点和网页那边一致。
    private func show(_ body: [String: Any]) async -> [String: Any] {
        let c = UNMutableNotificationContent()
        c.title = (body["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "小手机"
        c.body = body["body"] as? String ?? ""
        c.sound = .default
        var info: [String: Any] = [:]
        if let r = body["route"] as? String { info["route"] = r }
        if let a = body["appId"] as? String { info["appId"] = a }
        c.userInfo = info

        let id = (body["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? "phone-\(Int(Date().timeIntervalSince1970 * 1000))"
        // trigger 为 nil 就是马上发
        let req = UNNotificationRequest(identifier: id, content: c, trigger: nil)
        do {
            try await center.add(req)
            return ["shown": true]
        } catch {
            return ["error": "发不出去：\(error.localizedDescription)"]
        }
    }
}

// MARK: - 点开之后回到网页

extension NotifyBridge: UNUserNotificationCenterDelegate {

    /// app 正在前台时收到自己发的通知：**照常弹**。
    ///
    /// 上一版这里返回空，想着「网页在前台有自己那条横幅，两条一起出来是重的」。
    /// 那个想法是错的，而且正好把唯一能验证的那一下变没了：
    ///
    ///   一、网页只在 `document.visibilityState !== 'visible'` 时才叫这里发
    ///       （push.js 的 shouldUseSystem），前台根本不会走到这儿。
    ///   二、真正会在前台走到这儿的只有「试一条系统通知」—— 人正看着屏幕
    ///       按下去，却什么都不出现，看起来就是通知坏了。
    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                willPresent n: UNNotification) async
        -> UNNotificationPresentationOptions { [.banner, .list, .sound] }

    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                didReceive r: UNNotificationResponse) async {
        let info = r.notification.request.content.userInfo
        let payload: [String: Any] = [
            "appId": info["appId"] as? String ?? "",
            "route": info["route"] as? String ?? "",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        await MainActor.run { deliver(json) }
    }

    /// 交给网页。页面还在载就先记着，载完再交。
    @MainActor private func deliver(_ json: String) {
        pending = json
        reloads = 0
        flush()
    }

    /// 把记着的那一下交出去。页面载完、以及回到前台时各叫一次。
    ///
    /// **只有回 true 才算交到了。** 网页那头两份 phoneNotifyOpen（index.html 的
    /// 占位、push.js 的正式那份）都回 true。回别的说明这张页面上根本没有它，
    /// 也就是上面说的那张空文档；抛错则是进程本身没了。两种都放回去、叫外壳
    /// 重载，载完（didFinish）再交一次。
    func flush() {
        guard let json = pending, let w = web, !w.isLoading, w.url != nil else { return }
        pending = nil
        w.evaluateJavaScript("window.phoneNotifyOpen && window.phoneNotifyOpen(\(json))") { [weak self] got, err in
            guard let self = self else { return }
            if err == nil, (got as? Bool) == true { return }
            self.pending = json
            guard self.reloads < Self.maxReloads else { return }
            self.reloads += 1
            self.reload?()
        }
    }
}

// MARK: - 网页那头调过来

extension NotifyBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        switch body["action"] as? String ?? "" {
        case "status":  Task { replyHandler(await status(), nil) }
        case "request": Task { replyHandler(await request(), nil) }
        case "show":    Task { replyHandler(await show(body), nil) }
        default:        replyHandler(["error": "不认识的动作"], nil)
        }
    }
}
