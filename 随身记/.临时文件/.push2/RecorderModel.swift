import AVFoundation
import SwiftUI
import UIKit

@MainActor
final class RecorderModel: ObservableObject {
    enum State { case idle, recording, finishing }

    @Published var state: State = .idle
    @Published var liveText = ""
    @Published var level: Float = 0
    /// 最近的音量，用来画波形（最新的在最后）
    @Published var levels: [Float] = Array(repeating: 0, count: RecorderModel.barCount)
    static let barCount = 36
    @Published var lastRefresh: Date?
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published private(set) var entries: [Entry] = EntryStore.shared.entries
    @Published var elapsed: TimeInterval = 0

    private var asr: DoubaoASR?
    private var capture: AudioCapture?
    private var startDate = Date()
    private var timer: Timer?

    var todayEntries: [Entry] {
        let cal = Calendar.current
        return entries.filter { cal.isDateInToday($0.date) }.sorted { $0.date > $1.date }
    }

    var earlierEntries: [Entry] {
        let cal = Calendar.current
        return entries.filter { !cal.isDateInToday($0.date) }.sorted { $0.date > $1.date }.prefix(30).map { $0 }
    }

    // MARK: 开始

    func start() {
        guard state == .idle else { return }
        errorMessage = nil
        guard AppSettings.isConfigured else {
            errorMessage = "先到右上角设置里填好豆包的App ID和Access Token。"
            return
        }
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                if granted { self.beginRecording() }
                else { self.errorMessage = "没有麦克风权限，请到“设置→随身记”里打开麦克风。" }
            }
        }
    }

    private func beginRecording() {
        guard state == .idle else { return }
        let asr = DoubaoASR()
        let capture = AudioCapture()
        asr.onText = { text in
            Task { @MainActor in self.liveText = text }
        }
        asr.onError = { msg in
            Task { @MainActor in self.handleError(msg) }
        }
        capture.onChunk = { [weak asr] chunk in asr?.sendAudio(chunk) }
        capture.onLevel = { lv in
            Task { @MainActor in
                self.level = lv
                self.levels.removeFirst()
                self.levels.append(lv)
            }
        }

        asr.start(.init(appID: AppSettings.appID,
                        accessToken: AppSettings.accessToken,
                        resourceID: AppSettings.resourceID,
                        hotwords: AppSettings.cachedHotwords))
        do {
            try capture.start()
        } catch {
            asr.cancel()
            errorMessage = "麦克风启动失败：\(error.localizedDescription)"
            return
        }
        self.asr = asr
        self.capture = capture
        startDate = Date()
        liveText = ""
        elapsed = 0
        levels = Array(repeating: 0, count: Self.barCount)
        state = .recording
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            Task { @MainActor in self.elapsed = Date().timeIntervalSince(self.startDate) }
        }
    }

    // MARK: 停止

    func stop() {
        guard state == .recording, let asr, let capture else { return }
        state = .finishing
        timer?.invalidate()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let rest = capture.stop()
        level = 0
        asr.finish(lastChunk: rest) { final in
            Task { @MainActor in self.save(final) }
        }
    }

    private func save(_ final: String) {
        let text = (final.isEmpty ? liveText : final).trimmingCharacters(in: .whitespacesAndNewlines)
        asr = nil
        capture = nil
        state = .idle
        if !text.isEmpty {
            EntryStore.shared.add(Entry(date: startDate, text: text))
            entries = EntryStore.shared.entries
            sync()
        }
        liveText = ""
    }

    private func handleError(_ msg: String) {
        errorMessage = msg
        if state == .recording {
            timer?.invalidate()
            _ = capture?.stop()
            level = 0
            let text = liveText
            asr?.cancel()
            save(text)
        }
    }

    // MARK: 同步

    func sync() {
        let result = ObsidianWriter.syncPending()
        ObsidianWriter.checkMerged()
        entries = EntryStore.shared.entries
        switch result {
        case .success(let n):
            syncMessage = n > 0 ? "已上传，电脑收到后图标会变绿" : syncMessage
        case .failure(let e):
            syncMessage = "暂未存入Obsidian（\(e.localizedDescription)），下次自动补存"
        }
    }

    /// 下拉刷新：补传没送出的记录、检查电脑是否已收到、重读词库
    func refresh() async {
        let before = EntryStore.shared.unsynced.count
        let result = ObsidianWriter.syncPending()
        let words = ObsidianWriter.loadHotwords().count
        try? await Task.sleep(nanoseconds: 400_000_000)
        ObsidianWriter.checkMerged()
        entries = EntryStore.shared.entries
        lastRefresh = Date()
        let waiting = entries.filter { $0.isSent && !$0.isMerged }.count
        var parts: [String] = []
        switch result {
        case .success(let n):
            if before > 0 { parts.append("补传\(n)条") }
        case .failure(let e):
            parts.append("上传失败：\(e.localizedDescription)")
        }
        parts.append(waiting == 0 ? "电脑都已收到" : "\(waiting)条等电脑接收")
        parts.append("词库\(words)个词")
        syncMessage = parts.joined(separator: "，")
    }

    func refreshHotwords() -> Int {
        ObsidianWriter.loadHotwords().count
    }

    func onAppear() {
        _ = ObsidianWriter.loadHotwords()
        sync()
        SigningInfo.scheduleReminder()
        checkPendingStart()
    }

    func checkPendingStart() {
        if UserDefaults.standard.bool(forKey: "pendingStart") {
            UserDefaults.standard.set(false, forKey: "pendingStart")
            start()
        }
    }
}
