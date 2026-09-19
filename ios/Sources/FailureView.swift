import UIKit

/// 载入失败时盖在上面的一页。只说清楚出了什么事，以及接下来能做什么。
final class FailureView: UIView {

    private let onRetry: () -> Void
    private let onSettings: () -> Void

    init(message: String, onRetry: @escaping () -> Void, onSettings: @escaping () -> Void) {
        self.onRetry = onRetry
        self.onSettings = onSettings
        super.init(frame: .zero)
        backgroundColor = .systemBackground

        let title = UILabel()
        title.text = "无法载入"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textAlignment = .center

        let body = UILabel()
        body.text = message
        body.font = .systemFont(ofSize: 14)
        body.textColor = .secondaryLabel
        body.numberOfLines = 0
        body.textAlignment = .center

        let retry = Self.button(title: "重新载入", filled: true)
        retry.addTarget(self, action: #selector(tapRetry), for: .touchUpInside)

        let settings = Self.button(title: "外壳设置", filled: false)
        settings.addTarget(self, action: #selector(tapSettings), for: .touchUpInside)

        let hint = UILabel()
        hint.text = "任何时候摇动设备都可以打开外壳设置。"
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .tertiaryLabel
        hint.numberOfLines = 0
        hint.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [title, body, retry, settings, hint])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .fill
        stack.setCustomSpacing(24, after: body)
        stack.setCustomSpacing(24, after: settings)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -32),
            retry.heightAnchor.constraint(equalToConstant: 46),
            settings.heightAnchor.constraint(equalToConstant: 46),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    private static func button(title: String, filled: Bool) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        b.layer.cornerRadius = 12
        if filled {
            b.backgroundColor = .label
            b.setTitleColor(.systemBackground, for: .normal)
        } else {
            b.layer.borderWidth = 1
            b.layer.borderColor = UIColor.separator.cgColor
            b.setTitleColor(.label, for: .normal)
        }
        return b
    }

    @objc private func tapRetry() { onRetry() }
    @objc private func tapSettings() { onSettings() }
}
