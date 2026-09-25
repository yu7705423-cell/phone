import UIKit

// iOS 外壳的入口。没有 Storyboard、没有 Scene，就一个窗口装一个 WebView。
// 界面全部由网页画，这一层只负责把 WebKit 的开关调到位。
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = ShellViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    /// eira://chat/会话：Bark 的通知点开时打开这个链接，跳到那段会话。
    /// 冷启动也走这里（没有 Scene 的 app，系统在 didFinishLaunching 之后再叫这一下）
    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        (window?.rootViewController as? ShellViewController)?.openLink(url) ?? false
    }
}
