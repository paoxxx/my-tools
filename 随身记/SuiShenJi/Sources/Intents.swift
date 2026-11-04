import AppIntents
import Foundation

extension Notification.Name {
    static let startRecordingRequested = Notification.Name("startRecordingRequested")
}

/// 给操作按钮和快捷指令用：打开随身记并直接进入快捷输入
struct StartRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "随身记快捷输入"
    static var description = IntentDescription("打开随身记并马上出键盘输入")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: "pendingStart")
        NotificationCenter.default.post(name: .startRecordingRequested, object: nil)
        return .result()
    }
}

struct SuiShenJiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartRecordingIntent(),
            phrases: ["用\(.applicationName)快捷输入", "\(.applicationName)开始记录"],
            shortTitle: "快捷输入",
            systemImageName: "square.and.pencil"
        )
    }
}
