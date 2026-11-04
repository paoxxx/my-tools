import Foundation
import UserNotifications

/// 读取免费签名的到期时间，快到期时提醒重新安装
enum SigningInfo {
    static var expirationDate: Date? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8)) else { return nil }
        let xml = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let plist = try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any] else { return nil }
        return plist["ExpirationDate"] as? Date
    }

    /// 剩余天数（不足一天算0）
    static var daysLeft: Int? {
        guard let d = expirationDate else { return nil }
        return Calendar.current.dateComponents([.day], from: Date(), to: d).day
    }

    static func scheduleReminder() {
        guard let exp = expirationDate else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            center.removePendingNotificationRequests(withIdentifiers: ["signing"])
            let fire = exp.addingTimeInterval(-24 * 3600)
            guard fire > Date() else { return }
            let content = UNMutableNotificationContent()
            content.title = "随身记明天到期"
            content.body = "把手机连上Mac，在Xcode里点一下运行，重新安装就好，数据不会丢。"
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            center.add(UNNotificationRequest(identifier: "signing", content: content, trigger: trigger))
        }
    }
}
