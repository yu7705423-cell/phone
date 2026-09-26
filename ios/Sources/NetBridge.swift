import Foundation
import WebKit

// 替网页发请求。网页那头是 system/net.js。
//
// ---- 为什么要有这一层 ----
//
// 跨域是**浏览器**的规矩，不是 HTTP 的规矩。网页发出去的跨域请求要对方在响应头里
// 点头才读得到，而很多语音、生图接口压根没考虑过浏览器直连 —— 于是装在这台手机上
// 的 app 明明有网，却连不上一个用 curl 一试就通的地址。
//
// 这一层用系统自己的网络栈发，同样的请求照样通。只有装成 app 时才有；
// 浏览器里网页照常直连，通不通看对方。
//
// ---- 只做转发，不做判断 ----
//
// 不改地址、不加自己的头、不挑哪些能发哪些不能发。状态码、响应头、响应体原样
// 交回去，连错误也原样报 —— 这一层要是自作聪明，上面那层就再也查不出真实原因，
// 而「查不出真实原因」正是它要解决的问题。

final class NetBridge: NSObject {

    // 响应体走 base64 过桥。太大的不接 —— WKScriptMessage 的回包是一个
    // JS 字符串，几十兆的 base64 会把内存顶穿，那比失败更糟。
    private static let maxBytes = 24 * 1024 * 1024

    // 默认这么久。**生图这类接口一张要跑一两分钟**，从前写死 120 秒，
    // 于是慢一点的模型每一次都在这里被掐掉，网页那头只看到一句
    // 「请求超时」，看不出是本机掐的还是对面没回。
    private static let defaultTimeout: TimeInterval = 300

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        // 这里放宽到很大，真正的期限由每一个请求自己带（见下面的 timeout）——
        // 会话级的那一个是所有请求共用的，压不住也放不开单独某一类
        cfg.timeoutIntervalForRequest = 600
        cfg.timeoutIntervalForResource = 900
        return URLSession(configuration: cfg)
    }()

    private func send(_ body: [String: Any]) async -> [String: Any] {
        guard let raw = body["url"] as? String, let url = URL(string: raw) else {
            return ["error": "这个地址认不出来"]
        }
        var req = URLRequest(url: url)
        req.httpMethod = (body["method"] as? String ?? "GET").uppercased()
        // 网页那头可以按接口给一个期限。给了就用它，没给用默认
        if let t = body["timeout"] as? Double, t > 0 {
            req.timeoutInterval = t
        } else {
            req.timeoutInterval = Self.defaultTimeout
        }
        for (k, v) in (body["headers"] as? [String: Any] ?? [:]) {
            req.setValue(String(describing: v), forHTTPHeaderField: k)
        }
        if let b64 = body["body"] as? String, !b64.isEmpty,
           let data = Data(base64Encoded: b64) {
            req.httpBody = data
        }

        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                return ["error": "回来的不是一个 HTTP 响应"]
            }
            if data.count > Self.maxBytes {
                return ["error": "回来的内容太大（\(data.count / 1024 / 1024) MB），这一层转不过去"]
            }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields {
                headers[String(describing: k).lowercased()] = String(describing: v)
            }
            return [
                "status": http.statusCode,
                "headers": headers,
                "body": data.base64EncodedString(),
            ]
        } catch {
            // 原样报。上面那层要靠这句话分清是域名解析不了、超时、还是证书问题。
            // 超时另外标一个记号：那一种的下一步是「把期限调大」，
            // 和「地址不通」完全不是一回事，混成一句等于没说
            let ns = error as NSError
            let timedOut = ns.domain == NSURLErrorDomain && ns.code == NSURLErrorTimedOut
            return ["error": error.localizedDescription, "timedOut": timedOut,
                    "seconds": req.timeoutInterval]
        }
    }
}

extension NetBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // 只收应用自己主页面发来的。子 frame 里是沙盒中别人写的网页（工具箱、主屏组件），见 ARCHITECTURE 4.249
        guard message.frameInfo.isMainFrame else { replyHandler(nil, "不接受子页面的请求"); return }
        let body = message.body as? [String: Any] ?? [:]
        switch body["action"] as? String ?? "" {
        case "fetch":
            Task { replyHandler(await send(body), nil) }
        default:
            replyHandler(["error": "不认识的动作"], nil)
        }
    }
}
