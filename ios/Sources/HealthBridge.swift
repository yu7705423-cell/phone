import Foundation
import HealthKit
import WebKit

// 把 iOS「健康」app 里的数据读给网页。
//
// 网页自己要不到：浏览器没有这个 API。所以由这一层读，通过
// WKScriptMessageHandlerWithReply 回给网页，网页那头是 system/healthkit.js。
//
// **只读，不写。** 这只 app 不往「健康」里写任何东西，申请的权限也只有读。
//
// ---- 装了也未必能用 ----
//
// 读健康数据要 com.apple.developer.healthkit 这个 entitlement，而它是
// **签名时**写进去的。这个项目发出去的是未签名的 ipa，各人自己签：
// TrollStore 与付费开发者账号拿得到，免费 Apple ID 多半拿不到。
//
// 所以这里不假设它一定成，把系统返回的错误原样回给网页显示 ——
// 那是签名的事，不是坏了，用户得看得出区别。

final class HealthBridge: NSObject {

    static let available = HKHealthStore.isHealthDataAvailable()

    private let store = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var out = Set<HKObjectType>()
        if let t = HKObjectType.quantityType(forIdentifier: .stepCount) { out.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .bodyMass) { out.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .dietaryWater) { out.insert(t) }
        if let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { out.insert(t) }
        return out
    }

    // MARK: - 三个动作

    private func request() async -> [String: Any] {
        guard Self.available else { return ["error": "这台设备没有健康数据"] }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            return ["granted": true]
        } catch {
            // 签名里没带 HealthKit 权限时就落在这儿
            return ["error": "系统没有授权：\(error.localizedDescription)"]
        }
    }

    private func status() -> [String: Any] {
        ["available": Self.available]
    }

    /// 最近 days 天，一天一行。读不到的项不出现在那一行里，网页那边照原样保留手填的值。
    private func read(days: Int) async -> [String: Any] {
        guard Self.available else { return ["error": "这台设备没有健康数据"] }
        let cal = Calendar.current
        let end = cal.startOfDay(for: Date()).addingTimeInterval(86400)
        guard let start = cal.date(byAdding: .day, value: -max(1, days), to: cal.startOfDay(for: Date()))
        else { return ["error": "日期算不出来"] }

        var rows: [String: [String: Any]] = [:]
        let fmt = DateFormatter()
        fmt.calendar = cal
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"

        func put(_ date: Date, _ key: String, _ value: Any) {
            let k = fmt.string(from: date)
            var row = rows[k] ?? ["date": k]
            row[key] = value
            rows[k] = row
        }

        // 步数与饮水是累加的，一次分桶查完
        if let t = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            for (day, v) in await sums(t, unit: .count(), from: start, to: end, cal: cal) {
                put(day, "steps", Int(v.rounded()))
            }
        }
        if let t = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
            // 本地那个字段记的是「几杯」，一杯按 250 毫升折算
            for (day, v) in await sums(t, unit: .liter(), from: start, to: end, cal: cal) {
                put(day, "water", Int((v * 1000 / 250).rounded()))
            }
        }

        // 体重取当天最后一次称的
        if let t = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            for s in await samples(t, from: start, to: end) {
                guard let q = s as? HKQuantitySample else { continue }
                put(s.endDate, "weightKg", q.quantity.doubleValue(for: .gramUnit(with: .kilo)))
            }
        }

        // 睡眠按「醒来那天」归日，和人的习惯一致：凌晨三点睡的算前一晚
        if let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            var mins: [String: Double] = [:]
            for s in await samples(t, from: start, to: end) {
                guard let c = s as? HKCategorySample, asleep(c.value) else { continue }
                let k = fmt.string(from: c.endDate)
                mins[k, default: 0] += c.endDate.timeIntervalSince(c.startDate) / 60
            }
            for (k, v) in mins {
                var row = rows[k] ?? ["date": k]
                row["sleepMin"] = Int(v.rounded())
                rows[k] = row
            }
        }

        return ["days": rows.values.sorted { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") }]
    }

    /// 这一段算不算睡着了。
    ///
    /// iOS 16 把「睡着」拆成了核心、深度、REM 三档，老系统只有一个 asleep。
    /// 直接比原始值最稳，不必为几个枚举名写一串 available：
    /// 0 在床上、1 睡着（旧）、2 醒着、3 核心、4 深度、5 REM。
    private func asleep(_ value: Int) -> Bool { value == 1 || value >= 3 }

    // MARK: - 两种查询

    private func sums(_ type: HKQuantityType, unit: HKUnit, from: Date, to: Date,
                      cal: Calendar) async -> [(Date, Double)] {
        await withCheckedContinuation { go in
            let q = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: from, end: to),
                options: .cumulativeSum,
                anchorDate: cal.startOfDay(for: from),
                intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, got, _ in
                var out: [(Date, Double)] = []
                got?.enumerateStatistics(from: from, to: to) { s, _ in
                    if let v = s.sumQuantity()?.doubleValue(for: unit), v > 0 {
                        out.append((s.startDate, v))
                    }
                }
                go.resume(returning: out)
            }
            store.execute(q)
        }
    }

    private func samples(_ type: HKSampleType, from: Date, to: Date) async -> [HKSample] {
        await withCheckedContinuation { go in
            let q = HKSampleQuery(
                sampleType: type,
                predicate: HKQuery.predicateForSamples(withStart: from, end: to),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)]
            ) { _, got, _ in go.resume(returning: got ?? []) }
            store.execute(q)
        }
    }
}

// MARK: - 网页那头调过来

extension HealthBridge: WKScriptMessageHandlerWithReply {
    func userContentController(_ c: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // 只收应用自己主页面发来的。子 frame 里是沙盒中别人写的网页（工具箱、主屏组件），见 ARCHITECTURE 4.249
        guard message.frameInfo.isMainFrame else { replyHandler(nil, "不接受子页面的请求"); return }
        let body = message.body as? [String: Any] ?? [:]
        let action = body["action"] as? String ?? ""
        let days = (body["days"] as? NSNumber)?.intValue ?? 30

        switch action {
        case "status":
            replyHandler(status(), nil)
        case "request":
            Task { replyHandler(await request(), nil) }
        case "read":
            Task { replyHandler(await read(days: days), nil) }
        default:
            replyHandler(["error": "不认识的动作：\(action)"], nil)
        }
    }
}
