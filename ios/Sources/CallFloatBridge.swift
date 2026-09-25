import AVFoundation
import AVKit
import CoreMedia
import UIKit
import WebKit

// 通话的画中画（网页那头见 src/system/callfloat.js）。
//
// iOS 不许任何 app 画在别的 app 上面，没有安卓那种「悬浮窗权限」。能浮在桌面与别的 app 上的
// 只有系统画中画。画中画只认视频，所以这里把「头像、名字、时长、最新一句」画成一帧一帧的图，
// 塞进一个 AVSampleBufferDisplayLayer，交给 AVPictureInPictureController 弹成小窗。
//
// 网页每有变化就把状态交过来（action: set），这边重画一帧；点通话里那个按钮是 toggle。
// **只在用户点了之后才弹**，不设成退到后台自动弹 —— 那样每次离开 app 都冒出一个窗，而人没要过。
//
// 画中画要音频会话是 .playback，外壳一启动就配好了（ShellViewController.configureAudioSession）。

final class CallFloatBridge: NSObject {

    /// 这台设备能不能画中画（用户也可能在系统设置里关了自动画中画，那不影响手动开）
    static var available: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

    private let displayLayer = AVSampleBufferDisplayLayer()
    private let holder = UIView(frame: CGRect(x: 0, y: 0, width: 4, height: 3))
    private var controller: AVPictureInPictureController?

    private var on = false
    private var title = ""
    private var status = ""
    private var line = ""
    private var image: UIImage?

    /// 画中画的来源图层得挂在界面上（完全隐藏的视图系统不认），所以放一个几乎透明的小块
    func attach(to view: UIView) {
        holder.isUserInteractionEnabled = false
        holder.alpha = 0.01
        displayLayer.frame = holder.bounds
        displayLayer.videoGravity = .resizeAspect
        holder.layer.addSublayer(displayLayer)
        view.addSubview(holder)
    }

    private var active: Bool { controller?.isPictureInPictureActive == true }

    private func ensureController() -> AVPictureInPictureController? {
        if let c = controller { return c }
        let source = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: displayLayer, playbackDelegate: self)
        let c = AVPictureInPictureController(contentSource: source)
        c.delegate = self
        c.canStartPictureInPictureAutomaticallyFromInline = false
        c.requiresLinearPlayback = true
        controller = c
        return c
    }

    // MARK: - 状态

    private func apply(_ body: [String: Any]) {
        on = body["on"] as? Bool ?? false
        if !on {
            controller?.stopPictureInPicture()
            image = nil
            return
        }
        if let t = body["title"] as? String { title = t }
        if let s = body["status"] as? String { status = s }
        if let l = body["line"] as? String { line = l }
        if let url = body["image"] as? String { image = Self.decode(url) }
        _ = ensureController()
        render()
    }

    private static func decode(_ dataUrl: String) -> UIImage? {
        guard dataUrl.hasPrefix("data:"), let comma = dataUrl.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    private func toggle() -> [String: Any] {
        guard on, let c = ensureController() else { return ["error": "通话尚未开始"] }
        if c.isPictureInPictureActive {
            c.stopPictureInPicture()
            return ["pip": false]
        }
        render()
        guard c.isPictureInPicturePossible else {
            return ["error": "系统暂时无法开启画中画，请稍后再试"]
        }
        c.startPictureInPicture()
        return ["pip": true]
    }

    // MARK: - 画一帧

    private func render() {
        let size = CGSize(width: 480, height: 360)
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = true
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))

            let r: CGFloat = 58
            let circle = CGRect(x: size.width / 2 - r, y: 30, width: r * 2, height: r * 2)
            if let im = image {
                ctx.cgContext.saveGState()
                UIBezierPath(ovalIn: circle).addClip()
                im.draw(in: Self.fill(im.size, into: circle))
                ctx.cgContext.restoreGState()
            } else {
                UIColor(white: 0.94, alpha: 1).setFill()
                UIBezierPath(ovalIn: circle).fill()
                Self.center(String(title.prefix(1)), font: .systemFont(ofSize: 44, weight: .medium),
                            color: .darkGray, y: circle.midY - 27, width: size.width)
            }
            Self.center(title.isEmpty ? "通话" : title, font: .systemFont(ofSize: 28, weight: .medium),
                        color: .black, y: 186, width: size.width)
            Self.center(status, font: .systemFont(ofSize: 22), color: .gray, y: 226, width: size.width)
            // 字幕往后长，只留最新的那一截
            let tail = line.count > 40 ? "…" + String(line.suffix(40)) : line
            let para = NSMutableParagraphStyle()
            para.alignment = .center
            para.lineBreakMode = .byWordWrapping
            (tail as NSString).draw(
                with: CGRect(x: 28, y: 266, width: size.width - 56, height: 70),
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.darkGray,
                             .paragraphStyle: para],
                context: nil)
        }
        enqueue(img)
    }

    private static func center(_ text: String, font: UIFont, color: UIColor, y: CGFloat, width: CGFloat) {
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        para.lineBreakMode = .byTruncatingTail
        (text as NSString).draw(in: CGRect(x: 16, y: y, width: width - 32, height: font.lineHeight + 4),
                                withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: para])
    }

    private static func fill(_ image: CGSize, into rect: CGRect) -> CGRect {
        guard image.width > 0, image.height > 0 else { return rect }
        let k = max(rect.width / image.width, rect.height / image.height)
        let w = image.width * k, h = image.height * k
        return CGRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h)
    }

    private func enqueue(_ img: UIImage) {
        guard let cg = img.cgImage else { return }
        let w = cg.width, h = cg.height
        var pb: CVPixelBuffer?
        let attrs: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as [String: Any],
        ]
        guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA,
                                  attrs as CFDictionary, &pb) == kCVReturnSuccess,
              let buf = pb else { return }
        CVPixelBufferLockBaseAddress(buf, [])
        if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h,
                               bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                               space: CGColorSpaceCreateDeviceRGB(),
                               bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                                   | CGBitmapInfo.byteOrder32Little.rawValue) {
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        CVPixelBufferUnlockBaseAddress(buf, [])

        var desc: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buf,
                                                     formatDescriptionOut: &desc)
        guard let format = desc else { return }
        var timing = CMSampleTimingInfo(duration: .invalid,
                                        presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
                                        decodeTimeStamp: .invalid)
        var sb: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buf,
                                                 formatDescription: format, sampleTiming: &timing,
                                                 sampleBufferOut: &sb)
        guard let sample = sb else { return }
        // 到了就显示，不按时间戳排队
        if let list = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
           CFArrayGetCount(list) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(list, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict,
                                 Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        if displayLayer.status == .failed { displayLayer.flush() }
        displayLayer.enqueue(sample)
    }
}

// MARK: - 画中画的回调

extension CallFloatBridge: AVPictureInPictureSampleBufferPlaybackDelegate {
    func pictureInPictureController(_ c: AVPictureInPictureController, setPlaying playing: Bool) {}

    // 直播式的内容：没有进度条，不能快进
    func pictureInPictureControllerTimeRangeForPlayback(_ c: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }

    func pictureInPictureControllerIsPlaybackPaused(_ c: AVPictureInPictureController) -> Bool { false }

    func pictureInPictureController(_ c: AVPictureInPictureController,
                                    didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}

    func pictureInPictureController(_ c: AVPictureInPictureController,
                                    skipByInterval skipInterval: CMTime,
                                    completion completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

extension CallFloatBridge: AVPictureInPictureControllerDelegate {
    // 点小窗上的「回到 app」：什么都不用恢复，通话界面一直在
    func pictureInPictureController(_ c: AVPictureInPictureController,
                                    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler
                                    completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}

extension CallFloatBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        switch body["action"] as? String ?? "" {
        case "set":
            apply(body)
            replyHandler(["pip": active], nil)
        case "toggle":
            replyHandler(toggle(), nil)
        default:
            replyHandler(["error": "不认识的动作"], nil)
        }
    }
}
