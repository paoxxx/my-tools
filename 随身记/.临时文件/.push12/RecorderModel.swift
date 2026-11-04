import AVFoundation
import Photos
import SwiftUI
import UIKit

@MainActor
final class RecorderModel: ObservableObject {
    enum State { case idle, recording, finishing }

    @Published var state: State = .idle
    @Published var liveText = ""
    /// 音量单独放一个小对象里，只有按钮跟着刷新，整页不跟着重画，避免卡顿
    let meter = LevelMeter()
    /// 正在给哪条记录（图片）补录说明；nil表示普通录音
    @Published var captionTarget: UUID?
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

    /// 除今天以外的记录，按“年→月→日”分好组，新的在前
    var history: [YearGroup] {
        let cal = Calendar.current
        let old = entries.filter { !cal.isDateInToday($0.date) }
        let byDay = Dictionary(grouping: old) { cal.startOfDay(for: $0.date) }
        let days = byDay.map { DayGroup(day: $0.key, entries: $0.value.sorted { $0.date > $1.date }) }
        let byMonth = Dictionary(grouping: days) { cal.date(from: cal.dateComponents([.year, .month], from: $0.day))! }
        let months = byMonth.map { MonthGroup(month: $0.key, days: $0.value.sorted { $0.day > $1.day }) }
        let byYear = Dictionary(grouping: months) { cal.component(.year, from: $0.month) }
        return byYear.map { YearGroup(year: $0.key, months: $0.value.sorted { $0.month > $1.month }) }
            .sorted { $0.year > $1.year }
    }

    func delete(_ id: UUID) {
        EntryStore.shared.remove(id)
        entries = EntryStore.shared.entries
        sync()
    }

    // MARK: 开始

    func start() {
        guard state == .idle else { return }
        errorMessage = nil
        guard AppSettings.isConfigured else {
            errorMessage = "先到右上角设置里填好豆包的App ID和Access Token。"
            return
        }
        if AVAudioApplication.shared.recordPermission == .granted {
            beginRecording()
            return
        }
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                if granted { self.beginRecording() }
                else { self.errorMessage = "没有麦克风权限，请到“设置→随身记”里打开麦克风。" }
            }
        }
    }

    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    /// 提前设置好音频会话，按下按钮时少等一会儿
    func prewarm() {
        haptic.prepare()
        DispatchQueue.global(qos: .userInitiated).async {
            try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers])
        }
    }

    private func beginRecording() {
        guard state == .idle else { return }
        // 先切界面、先震动，让按下去立刻有反应；麦克风和网络在后台启动
        startDate = Date()
        liveText = ""
        elapsed = 0
        meter.reset()
        state = .recording
        haptic.impactOccurred()
        haptic.prepare()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            Task { @MainActor in self.elapsed = Date().timeIntervalSince(self.startDate) }
        }

        let asr = DoubaoASR()
        let capture = AudioCapture()
        asr.onText = { text in
            Task { @MainActor in self.liveText = text }
        }
        asr.onError = { msg in
            Task { @MainActor in self.handleError(msg) }
        }
        capture.onChunk = { [weak asr] chunk in asr?.sendAudio(chunk) }
        let meter = self.meter
        capture.onLevel = { lv in meter.feed(lv) }
        self.asr = asr
        self.capture = capture
        asr.start(.init(appID: AppSettings.appID,
                        accessToken: AppSettings.accessToken,
                        resourceID: AppSettings.resourceID,
                        hotwords: AppSettings.cachedHotwords))

        DispatchQueue.global(qos: .userInteractive).async {
            do {
                try capture.start()
            } catch {
                Task { @MainActor in
                    asr.cancel()
                    self.timer?.invalidate()
                    self.asr = nil
                    self.capture = nil
                    self.state = .idle
                    self.errorMessage = "麦克风启动失败：\(error.localizedDescription)"
                }
            }
        }
    }

    // MARK: 停止

    func stop() {
        guard state == .recording, let asr, let capture else { return }
        state = .finishing
        timer?.invalidate()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        meter.reset()
        let rest = capture.stop()
        asr.finish(lastChunk: rest) { final in
            Task { @MainActor in self.save(final) }
        }
    }

    private func save(_ final: String) {
        let text = (final.isEmpty ? liveText : final).trimmingCharacters(in: .whitespacesAndNewlines)
        asr = nil
        capture = nil
        state = .idle
        let target = captionTarget
        captionTarget = nil
        if !text.isEmpty {
            if let target {
                EntryStore.shared.appendCaption(target, text: text)
            } else {
                EntryStore.shared.add(Entry(date: startDate, text: text))
            }
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
            meter.reset()
            let text = liveText
            asr?.cancel()
            save(text)
        }
    }

    // MARK: 图片

    /// 点图片那一条：直接开始录音，录完的文字作为这张图的说明
    func startCaption(for id: UUID) {
        guard state == .idle else { return }
        captionTarget = id
        start()
        if state == .idle && errorMessage != nil { captionTarget = nil }
    }

    var captionEntry: Entry? {
        guard let id = captionTarget else { return nil }
        return entries.first { $0.id == id }
    }

    @Published var processing: String?

    /// 从选图面板发来的图片和视频：图片默认压缩、视频默认720P，勾了原图就保留原画质
    func addMedia(_ assets: [PHAsset], original: Bool) async {
        guard !assets.isEmpty else { return }
        let date = Date()
        let stamp = DateFormatter.fileStamp.string(from: date)
        var names: [String] = []
        for (i, a) in assets.enumerated() {
            processing = assets.count > 1 ? "正在处理第\(i + 1)/\(assets.count)个…" : "正在处理…"
            let base = "\(stamp)_\(i + 1)_\(UUID().uuidString.prefix(4))"
            if let name = await MediaExporter.export(a, original: original, baseName: base) {
                names.append(name)
            }
        }
        processing = nil
        guard !names.isEmpty else {
            errorMessage = "图片或视频读取失败，请重试"
            return
        }
        EntryStore.shared.add(Entry(date: date, text: "", images: names))
        entries = EntryStore.shared.entries
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        sync()
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
        prewarm()
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


/// 音量表：在录音线程里做平滑，最多每秒30次推给界面
final class LevelMeter: ObservableObject {
    @Published private(set) var value: Float = 0
    private var smooth: Float = 0
    private var lastPush = CFAbsoluteTimeGetCurrent()
    private let lock = NSLock()

    func feed(_ lv: Float) {
        lock.lock()
        // 声音起来时跟得快，落下时慢慢回落
        smooth = lv > smooth ? smooth + (lv - smooth) * 0.75 : smooth + (lv - smooth) * 0.2
        let now = CFAbsoluteTimeGetCurrent()
        let shouldPush = now - lastPush >= 1.0 / 30
        if shouldPush { lastPush = now }
        let v = smooth
        lock.unlock()
        if shouldPush {
            DispatchQueue.main.async { self.value = v }
        }
    }

    func reset() {
        lock.lock(); smooth = 0; lock.unlock()
        DispatchQueue.main.async { self.value = 0 }
    }
}


extension UIImage {
    /// 等比缩小到最长边不超过maxSide
    func scaledDown(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}


struct DayGroup: Identifiable {
    let day: Date
    let entries: [Entry]
    var id: Date { day }
}

struct MonthGroup: Identifiable {
    let month: Date
    let days: [DayGroup]
    var id: Date { month }
    var count: Int { days.reduce(0) { $0 + $1.entries.count } }
}

struct YearGroup: Identifiable {
    let year: Int
    let months: [MonthGroup]
    var id: Int { year }
    var count: Int { months.reduce(0) { $0 + $1.count } }
}
