import SwiftUI

@main
struct SuiShenJiApp: App {
    @StateObject private var model = RecorderModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        model.checkPendingStart()
                        model.sync()
                    } else {
                        model.stopIfRecording()   // 不在前台就停止录音
                    }
                }
        }
    }
}
