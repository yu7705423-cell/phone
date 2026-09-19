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
}
