import AVFoundation
import Foundation
import WebKit

// 保活。
//
// **为什么网页那套在 app 里不灵。** 网页的办法是循环播一段 `volume = 0` 的音频，
// 骗系统把这一页当成正在放东西的。在 Safari 里管用；装成 app 之后不管用 ——
// WebKit 不会为一个音量为零的元素去占音频焦点，系统那边压根不认为这只 app
// 在放音频，于是后台照停。外壳把 AVAudioSession 配好也没用，因为根本没人在放。
//
// 所以由这一层自己放。声音不是零音量，是**一段真的、极轻的噪声**
// （最低位上下抖一下，听不见，但确实是有波形的采样）—— 零样本的静音在
// 某些机型上同样会被当成没在放。
//
// ---- 为什么开着的时候要独占音频 ----
//
// 平时这只 app 的音频会话是 .playback + .mixWithOthers，不打断用户自己在放的
// 东西。但 **mixWithOthers 的音频是「次要音频」**，系统不拿它当「这只 app 正在
// 放东西」的凭据，后台该停还是停 —— 那样保活等于白开。
//
// 所以开着保活的这段时间换成不混音的 .playback，关掉再换回去。代价是
// **会打断用户自己正在放的音乐**。这一条写在设置那个开关的说明里，不含糊过去：
// 这是用户自己打开的功能，他得知道开了会发生什么。
//
// **这仍然不是什么正经办法**，和网页那套一样是将就：系统愿意让你活多久是它的事。
// 所以默认关着，由用户自己决定要不要用这点电量、这点打断，换这点存活时间。

final class KeepAliveBridge: NSObject {

    private var player: AVAudioPlayer?

    /// 一秒的 wav，最低位上抖一下。听不见，但不是零。
    private func quietWav() -> Data {
        let rate = 8000
        let n = rate
        var d = Data()
        func str(_ s: String) { d.append(contentsOf: s.utf8) }
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        str("RIFF"); u32(UInt32(36 + n * 2)); str("WAVE"); str("fmt ")
        u32(16); u16(1); u16(1)
        u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        str("data"); u32(UInt32(n * 2))
        for i in 0..<n { u16(UInt16(bitPattern: i % 2 == 0 ? 1 : -1)) }
        return d
    }

    private func start() -> [String: Any] {
        if player?.isPlaying == true { return info(on: true) }
        let session = AVAudioSession.sharedInstance()
        do {
            // 独占（不混音），否则系统不认为这只 app 在放东西，后台照停
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            return ["error": "音频会话没拿到：\(error.localizedDescription)"]
        }
        do {
            let p = try AVAudioPlayer(data: quietWav())
            p.numberOfLoops = -1
            p.volume = 0.01
            p.prepareToPlay()
            guard p.play() else { return ["error": "音频没能开始播放"] }
            player = p
            return info(on: true)
        } catch {
            return ["error": "保活开不起来：\(error.localizedDescription)"]
        }
    }

    private func stop() -> [String: Any] {
        player?.stop()
        player = nil
        // 换回混音，不再挡着用户自己放的东西
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
        return info(on: false)
    }

    /// 以播放器为准，不是以我们记的为准 —— 来一通电话就会被按停。
    private func status() -> [String: Any] { info(on: player?.isPlaying == true) }

    /// 回给网页的一份实情。**把系统那边的真实状态一起带回去** ——
    /// 上一版只回一个 on，开关打开之后屏幕上什么都不变，坏没坏谁也看不出来，
    /// 于是只能收到一句「完全没有」，没法往下查。
    private func info(on: Bool) -> [String: Any] {
        let s = AVAudioSession.sharedInstance()
        return [
            "on": on,
            "category": s.category.rawValue,
            "mixing": s.categoryOptions.contains(.mixWithOthers),
            "otherAudio": s.isOtherAudioPlaying,
        ]
    }
}

extension KeepAliveBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        switch body["action"] as? String ?? "" {
        case "start":  replyHandler(start(), nil)
        case "stop":   replyHandler(stop(), nil)
        case "status": replyHandler(status(), nil)
        default:       replyHandler(["error": "不认识的动作"], nil)
        }
    }
}
