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

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 120
        cfg.timeoutIntervalForResource = 300
        return URLSession(configuration: cfg)
    }()

    private func send(_ body: [String: Any]) async -> [String: Any] {
        guard let raw = body["url"] as? String, let url = URL(string: raw) else {
            return ["error": "这个地址认不出来"]
        }
        var req = URLRequest(url: url)
        req.httpMethod = (body["method"] as? String ?? "GET").uppercased()
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
            // 原样报。上面那层要靠这句话分清是域名解析不了、超时、还是证书问题
            return ["error": error.localizedDescription]
        }
    }
}

extension NetBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        switch body["action"] as? String ?? "" {
        case "fetch":
            Task { replyHandler(await send(body), nil) }
        default:
            replyHandler(["error": "不认识的动作"], nil)
        }
    }
}
