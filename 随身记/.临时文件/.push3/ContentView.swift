import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject var model: RecorderModel
    @State private var showSettings = false
    @State private var copiedID: UUID?

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()

                VStack(spacing: 0) {
                    banners
                    if model.state == .idle {
                        entryList
                    } else {
                        liveArea
                    }
                    Spacer(minLength: 0)
                    recordButton
                        .padding(.bottom, 12)
                }

                // 录音时：点屏幕任意空白处都停止
                if model.state == .recording {
                    Color.clear
                        .contentShape(Rectangle())
                        .ignoresSafeArea()
                        .onTapGesture { model.stop() }
                }
            }
            .navigationTitle("随身记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .disabled(model.state != .idle)
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView().environmentObject(model) }
            .onAppear { model.onAppear() }
            .onReceive(NotificationCenter.default.publisher(for: .startRecordingRequested)) { _ in
                model.checkPendingStart()
            }
        }
    }

    // MARK: 提示条

    @ViewBuilder private var banners: some View {
        VStack(spacing: 8) {
            if let days = SigningInfo.daysLeft, days <= 1 {
                banner("签名\(days <= 0 ? "今天" : "明天")到期：连上Mac，在Xcode里点运行重新安装。", color: .orange)
            }
            if let err = model.errorMessage {
                banner(err, color: .red)
            }
            if let msg = model.syncMessage, model.state == .idle {
                banner(msg, color: msg.contains("失败") || msg.contains("暂未") ? .orange : .green)
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private func banner(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(color)
    }

    // MARK: 录音中：实时文字

    private var liveArea: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle().fill(.red).frame(width: 10, height: 10)
                Text(model.state == .recording ? "正在录音  \(timeString(model.elapsed))" : "正在定稿…")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            ScrollViewReader { proxy in
                ScrollView {
                    Text(model.liveText.isEmpty ? "说吧，我在听。" : model.liveText)
                        .font(.title3)
                        .foregroundStyle(model.liveText.isEmpty ? .secondary : .primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .id("bottom")
                }
                .onChange(of: model.liveText) { _, _ in
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            if model.state == .recording {
                Text("点屏幕任意空白处停止")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .padding()
    }

    // MARK: 记录列表

    private var entryList: some View {
        List {
            if model.todayEntries.isEmpty && model.earlierEntries.isEmpty {
                Text("点下面的按钮开始说话，也可以设置成按侧边的操作按钮直接录音。")
                    .foregroundStyle(.secondary)
            }
            if !model.todayEntries.isEmpty {
                Section {
                    ForEach(model.todayEntries) { row($0, showDate: false) }
                } header: {
                    Text("今天")
                } footer: {
                    Text(model.lastRefresh.map { "下拉刷新同步状态 · 上次刷新 \(DateFormatter.time.string(from: $0))" } ?? "下拉刷新同步状态")
                }
            }
            if !model.earlierEntries.isEmpty {
                Section("之前") {
                    ForEach(model.earlierEntries) { row($0, showDate: true) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
    }

    private func row(_ e: Entry, showDate: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(showDate ? DateFormatter.full.string(from: e.date) : DateFormatter.time.string(from: e.date))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                if copiedID == e.id {
                    Text("已复制").font(.caption).foregroundStyle(.green)
                }
                statusLabel(e)
            }
            Text(e.text)
                .font(.body)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = e.text
            copiedID = e.id
        }
    }

    @ViewBuilder private func statusLabel(_ e: Entry) -> some View {
        if e.isMerged {
            Label("电脑已收到", systemImage: "checkmark.circle.fill")
                .font(.caption2).foregroundStyle(.green)
        } else if e.isSent {
            Label("已上传", systemImage: "icloud.and.arrow.up")
                .font(.caption2).foregroundStyle(.blue)
        } else {
            Label("待上传", systemImage: "icloud.slash")
                .font(.caption2).foregroundStyle(.orange)
        }
    }

    // MARK: 录音按钮（声波环和按钮融为一体）

    private var recordButton: some View {
        let recording = model.state != .idle
        return Button {
            if model.state == .idle { model.start() } else { model.stop() }
        } label: {
            ZStack {
                // 外圈声波：跟着说话音量一圈圈往外长
                RadialWaveView(levels: model.levels)
                    .frame(width: 210, height: 210)
                    .opacity(recording ? 1 : 0)
                // 呼吸光晕
                Circle()
                    .fill(Theme.gradient)
                    .frame(width: 96, height: 96)
                    .scaleEffect(recording ? 1 + CGFloat(model.level) * 0.35 : 1)
                    .opacity(recording ? 0.25 : 0)
                    .blur(radius: 8)
                // 按钮本体
                Circle()
                    .fill(Theme.gradient)
                    .frame(width: 84, height: 84)
                    .shadow(color: Theme.pink.opacity(0.35), radius: recording ? 14 : 8, y: 4)
                Group {
                    if recording {
                        RoundedRectangle(cornerRadius: 7).fill(.white).frame(width: 28, height: 28)
                    } else {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
                .transition(.scale.combined(with: .opacity))
            }
            .frame(width: 210, height: recording ? 210 : 110)
            .contentShape(Circle().inset(by: 50))
        }
        .buttonStyle(PressScaleStyle())
        .disabled(model.state == .finishing)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: recording)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}


enum Theme {
    static let orange = Color(red: 1.0, green: 0.54, blue: 0.24)
    static let pink = Color(red: 0.93, green: 0.18, blue: 0.47)
    static let gradient = LinearGradient(colors: [orange, pink], startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// 按下时轻微缩小，松手弹回
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// 环形声波：最新的音量在正上方，越早的越往两侧下方扩散，像涟漪一样
struct RadialWaveView: View {
    var levels: [Float]

    var body: some View {
        Canvas { ctx, size in
            let n = levels.count
            guard n > 0 else { return }
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let inner: CGFloat = 50
            let maxLen = min(size.width, size.height) / 2 - inner - 4
            let bars = 64
            for i in 0..<bars {
                // 左右对称：i=0 在正上方，对应最新的音量
                let k = min(i, bars - i)
                let idx = max(0, n - 1 - k * (n - 1) / (bars / 2))
                let lv = CGFloat(levels[idx])
                let len = 3 + lv * maxLen
                let angle = Double(i) / Double(bars) * 2 * .pi - .pi / 2
                let dx = CGFloat(cos(angle)), dy = CGFloat(sin(angle))
                var path = Path()
                path.move(to: CGPoint(x: c.x + dx * inner, y: c.y + dy * inner))
                path.addLine(to: CGPoint(x: c.x + dx * (inner + len), y: c.y + dy * (inner + len)))
                let t = Double(k) / Double(bars / 2)
                let color = Color(red: 1.0 - 0.07 * t, green: 0.54 - 0.36 * t, blue: 0.24 + 0.23 * t)
                ctx.stroke(path, with: .color(color.opacity(0.95 - 0.45 * t)),
                           style: StrokeStyle(lineWidth: 4, lineCap: .round))
            }
        }
        .allowsHitTesting(false)
    }
}
