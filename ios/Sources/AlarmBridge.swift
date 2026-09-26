import Foundation
import SwiftUI
import WebKit
#if canImport(AlarmKit)
import AlarmKit
#endif

// 把待办排进 iOS 自己的闹钟。网页那头是 system/alarm.js。
//
// ---- 为什么非要这一层 ----
//
// 网页做不到「关掉之后还能按时响」：iOS 上网页没有后台调度，Web Push 还要一个
// 服务端。AlarmKit 排的是**系统级闹钟**，穿透静音与专注模式，app 没在跑也照响。
//
// ---- 和「健康」那座桥不一样的两点 ----
//
// 一、**不要 entitlement。** HealthKit 要 com.apple.developer.healthkit，那是签名
//     时写进去的，未签名的 ipa 自己签多半拿不到。AlarmKit 只要 Info.plist 里的
//     NSAlarmKitUsageDescription 加一次运行时授权，所以自己签也用得上。
// 二、**要 iOS 26。** 本项目最低支持 15，所以整段用 @available 圈起来，
//     老系统上一律回「unsupported」，界面照实写。
//
// 另外整个文件用 #if canImport(AlarmKit) 包着：编这只 app 的 SDK 可能还没有这个
// 框架（build.sh 用的是 runner 上那套 Xcode）。SDK 里没有就整段不编，
// 报「这套构建里没有」—— 编不过比少个功能糟得多。
//
// ---- 只排固定时刻，不做倒计时 ----
//
// AlarmKit 的倒计时那一档要配一个 widget extension 来画 Live Activity，
// 没有它系统会把闹钟撤掉。固定时刻的告警由系统自己画，不需要扩展。
// 这只 app 要的正是固定时刻（「周四 9 点交表」），所以只做这一档。

#if canImport(AlarmKit)
@available(iOS 26.0, *)
private struct TodoMeta: AlarmMetadata {
    init() {}
}
#endif

final class AlarmBridge: NSObject {

    /// 这套构建里有没有这个框架，而且系统够不够新。两样都要。
    static var available: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        return false
        #else
        return false
        #endif
    }

    // MARK: - 动作

    private func unsupported() -> [String: Any] {
        #if canImport(AlarmKit)
        return ["status": "unsupported", "error": "系统闹钟需要 iOS 26 或更新的系统"]
        #else
        return ["status": "unsupported", "error": "这个版本的构建里没有系统闹钟"]
        #endif
    }

    private func statusNow() -> [String: Any] {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { return unsupported() }
        switch AlarmManager.shared.authorizationState {
        case .authorized:    return ["status": "granted"]
        case .denied:        return ["status": "denied"]
        default:             return ["status": "notDetermined"]
        }
        #else
        return unsupported()
        #endif
    }

    private func requestAuth() async -> [String: Any] {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { return unsupported() }
        if let bad = await ensureAuth() { return ["error": bad] }
        return ["status": "granted"]
        #else
        return unsupported()
        #endif
    }

    #if canImport(AlarmKit)
    /// 确保拿到授权。回来的是错误原文，nil 表示可以往下走。
    ///
    /// **第一次弹询问表那一下 requestAuthorization 会抛** —— 界面上看到的是
    /// 「AlarmKitCore.AuthorizationManager.AuthorizationError 错误 1」。人这时候
    /// 还在看那张表，一下都没点呢：那一抛不代表被拒了，只代表这一次调用没等到
    /// 结果。照它的字面报上去，用户看到一句看不懂的话，还得自己再点一次「排入」。
    ///
    /// 所以抛完不当场认输：隔半秒读一次系统那边的状态，读到 authorized 就继续，
    /// 读到 denied 才算真拒。一次点击就成。
    ///
    /// 等到三十秒为止 —— 再久多半是人把那张表晾在那儿了，照实说一句，别一直挂着。
    @available(iOS 26.0, *)
    private func ensureAuth() async -> String? {
        if AlarmManager.shared.authorizationState == .authorized { return nil }
        var thrown: String?
        do { _ = try await AlarmManager.shared.requestAuthorization() }
        catch { thrown = error.localizedDescription }

        for _ in 0..<60 {
            switch AlarmManager.shared.authorizationState {
            case .authorized: return nil
            case .denied:     return "系统没有授予闹钟权限。可在「设置」中重新开启"
            default: break
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return thrown ?? "等待授权超时，请再试一次"
    }
    #endif

    /// 排一个。at 是毫秒时间戳，和网页那边一致。
    private func schedule(id: String, title: String, at ms: Double) async -> [String: Any] {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { return unsupported() }
        guard let uuid = Self.uuid(from: id) else { return ["error": "这条待办的编号认不出来"] }
        let when = Date(timeIntervalSince1970: ms / 1000)
        guard when > Date() else { return ["error": "这个时刻已经过去了"] }

        // 没授权先要一次。**自动要**：用户刚点了「排进系统闹钟」，
        // 这时候弹询问表正是他预期的那一下。等他点完再接着排（见 ensureAuth）
        if let bad = await ensureAuth() { return ["error": bad] }

        let label = title.isEmpty ? "待办" : title
        // 停止那个按钮要自己给，没有现成的 .stopButton
        let stop = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "停止"),
            textColor: .white,
            systemImageName: "stop.fill")
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: label),
            stopButton: stop)
        let attributes = AlarmAttributes<TodoMeta>(
            presentation: AlarmPresentation(alert: alert),
            metadata: TodoMeta(),
            tintColor: Color.accentColor)
        // 泛型参数推不出来，要写明是哪一种 metadata
        let config = AlarmManager.AlarmConfiguration<TodoMeta>(
            schedule: .fixed(when),
            attributes: attributes)
        do {
            _ = try await AlarmManager.shared.schedule(id: uuid, configuration: config)
            return ["alarmId": uuid.uuidString]
        } catch {
            return ["error": error.localizedDescription]
        }
        #else
        return unsupported()
        #endif
    }

    private func cancel(id: String) async -> [String: Any] {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { return unsupported() }
        guard let uuid = Self.uuid(from: id) else { return ["ok": true] }
        do {
            try AlarmManager.shared.cancel(id: uuid)
            return ["ok": true]
        } catch {
            return ["error": error.localizedDescription]
        }
        #else
        return unsupported()
        #endif
    }

    /// 系统里现在挂着几个。排了没响是最难查的一种，所以给网页一个对账的口子。
    private func list() async -> [String: Any] {
        #if canImport(AlarmKit)
        guard #available(iOS 26.0, *) else { return unsupported() }
        do {
            let all = try AlarmManager.shared.alarms
            return ["ids": all.map { $0.id.uuidString }]
        } catch {
            return ["error": error.localizedDescription]
        }
        #else
        return unsupported()
        #endif
    }

    /// 网页那边的 id 是 `td_xxx` 这种，不是 UUID。**按内容散成一个固定的 UUID**
    /// —— 同一条待办每次都要散出同一个，撤的时候才找得回它。
    static func uuid(from id: String) -> UUID? {
        if let direct = UUID(uuidString: id) { return direct }
        var bytes = [UInt8](repeating: 0, count: 16)
        // FNV-1a 铺满十六个字节。不求密码学强度，只求稳定且不撞
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in Array(id.utf8) {
            hash = (hash ^ UInt64(byte)) &* 0x100000001b3
        }
        var second: UInt64 = hash
        for byte in Array(id.utf8).reversed() {
            second = (second ^ UInt64(byte)) &* 0x100000001b3
        }
        withUnsafeBytes(of: hash.bigEndian) { for (i, b) in $0.enumerated() { bytes[i] = b } }
        withUnsafeBytes(of: second.bigEndian) { for (i, b) in $0.enumerated() { bytes[8 + i] = b } }
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
                           bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}

extension AlarmBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // 只收应用自己主页面发来的。子 frame 里是沙盒中别人写的网页（工具箱、主屏组件），见 ARCHITECTURE 4.249
        guard message.frameInfo.isMainFrame else { replyHandler(nil, "不接受子页面的请求"); return }
        let body = message.body as? [String: Any] ?? [:]
        let action = body["action"] as? String ?? ""
        let id = body["id"] as? String ?? ""
        let title = body["title"] as? String ?? ""
        let at = (body["at"] as? NSNumber)?.doubleValue ?? 0

        switch action {
        case "status":
            replyHandler(statusNow(), nil)
        case "request":
            Task { replyHandler(await requestAuth(), nil) }
        case "schedule":
            Task { replyHandler(await schedule(id: id, title: title, at: at), nil) }
        case "cancel":
            Task { replyHandler(await cancel(id: id), nil) }
        case "list":
            Task { replyHandler(await list(), nil) }
        default:
            replyHandler(["error": "不认识的动作：\(action)"], nil)
        }
    }
}
