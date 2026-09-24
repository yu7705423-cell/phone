import UIKit

/// 网页画出第一帧之前盖在上面的一页：图标、一个转圈，必要时一行说明。
///
/// 从前一启动就直接去载网页。第一次打开时系统正弹着「是否允许使用网络」，
/// 那一下请求必然失败，于是弹窗后面已经是一整页「无法载入」加一串网址 ——
/// 用户还没来得及点「允许」，就先看到了报错。
///
/// 现在先盖这一页。网络没好（权限还没给、断网、切网）时就停在这里等，
/// 网络一通由外壳自己重新载入，这一页上不出现任何网址。
/// 真正载不进来（不是网络的问题）才换成失败页。
final class LaunchView: UIView {

    private let status = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)
        // 与外壳底色一致（ShellViewController.viewDidLoad），盖上、揭开都看不出接缝
        backgroundColor = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 0x0D / 255, green: 0x0E / 255, blue: 0x10 / 255, alpha: 1)
            : UIColor(red: 0xF2 / 255, green: 0xF3 / 255, blue: 0xF5 / 255, alpha: 1) }

        // 打包时 build.sh 放进去的那一张（与主屏幕图标同一张图）
        let icon = UIImageView(image: UIImage(named: "LaunchIcon"))
        icon.contentMode = .scaleAspectFit
        icon.layer.cornerRadius = 22
        icon.layer.cornerCurve = .continuous
        icon.clipsToBounds = true

        spinner.startAnimating()

        status.font = .systemFont(ofSize: 13)
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.textAlignment = .center
        status.isHidden = true

        let stack = UIStackView(arrangedSubviews: [icon, spinner, status])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.heightAnchor.constraint(equalToConstant: 96),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -24),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 40),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -40),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    /// 图标下面那一行。传 nil 收起
    func setStatus(_ text: String?) {
        status.text = text
        status.isHidden = (text ?? "").isEmpty
    }
}
