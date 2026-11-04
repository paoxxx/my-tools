import SwiftUI
import UIKit
import Photos

struct ContentView: View {
    @EnvironmentObject var model: RecorderModel
    @State private var showSettings = false
    @State private var copiedID: UUID?
    @State private var showPicker = false

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
            if let p = model.processing {
                banner(p, color: .blue)
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
                Text(model.state == .recording ? (model.captionTarget == nil ? "正在录音" : "正在给图片加说明") + "  \(timeString(model.elapsed))" : "正在定稿…")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            if let e = model.captionEntry {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(e.imageNames, id: \.self) { Thumb(name: $0) }
                    }
                }
                .frame(height: 72)
                if !e.text.isEmpty {
                    Text("已有说明：" + e.text).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
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
            if !e.text.isEmpty {
                Text(e.text)
                    .font(.body)
                    .textSelection(.enabled)
            }
            if !e.imageNames.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(e.imageNames, id: \.self) { name in
                            Thumb(name: name)
                        }
                    }
                }
                .allowsHitTesting(false)
                Label(e.text.isEmpty ? "点这一条，用语音加说明" : "点这一条，继续补充说明", systemImage: "mic.badge.plus")
                    .font(.caption)
                    .foregroundStyle(Theme.pink)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            if !e.imageNames.isEmpty {
                model.startCaption(for: e.id)   // 图片那一条：直接开始录说明
                return
            }
            guard !e.text.isEmpty else { return }
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

    // MARK: 录音按钮：横向大键，跟着音量跳动

    private var recordButton: some View {
        GeometryReader { geo in
            let gap: CGFloat = 12
            let photoW = (geo.size.width - gap) / 4
            HStack(spacing: gap) {
                Button { showPicker = true } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 22, weight: .semibold))
                        Text("图片").font(.system(size: 13, weight: .medium))
                    }
                    .foregroundStyle(Theme.pink)
                    .frame(width: photoW, height: 64)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.gradient, lineWidth: 1.5))
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
                .disabled(model.state != .idle)
                .opacity(model.state == .idle ? 1 : 0.4)

                RecordBar(meter: model.meter, state: model.state) {
                    if model.state == .idle { model.start() } else { model.stop() }
                }
                .frame(width: geo.size.width - gap - photoW)
            }
        }
        .frame(height: 140)
        .padding(.horizontal, 20)
        .fullScreenCover(isPresented: $showPicker) {
            MediaPickerView { assets, original in
                Task { await model.addMedia(assets, original: original) }
            }
        }
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
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// 横向录音大键：整块区域都能点；录音时按键随音量放大、光晕变亮，四周预留了跳动的空间
struct RecordBar: View {
    @ObservedObject var meter: LevelMeter
    var state: RecorderModel.State
    var action: () -> Void

    private let height: CGFloat = 64

    var body: some View {
        let recording = state != .idle
        // 开方让正常说话的音量也有明显起伏
        let lv = CGFloat(recording ? pow(meter.value, 0.6) : 0)
        Button(action: action) {
            ZStack {
                // 光晕：声音越大越亮越大
                Capsule()
                    .fill(Theme.gradient)
                    .frame(height: height)
                    .scaleEffect(x: 1 + lv * 0.12, y: 1 + lv * 1.1)
                    .blur(radius: 14)
                    .opacity(recording ? 0.3 + Double(lv) * 0.6 : 0)
                // 按键本体
                Capsule()
                    .fill(Theme.gradient)
                    .frame(height: height)
                    .scaleEffect(x: 1 + lv * 0.07, y: 1 + lv * 0.5)
                    .shadow(color: Theme.pink.opacity(0.3), radius: 8, y: 4)
                HStack(spacing: 10) {
                    Image(systemName: recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 22, weight: .semibold))
                    Text(state == .finishing ? "正在定稿…" : (recording ? "点击停止" : "点击说话"))
                        .font(.system(size: 18, weight: .semibold))
                }
                .foregroundStyle(.white)
            }
            .animation(.easeOut(duration: 0.08), value: lv)
            .frame(maxWidth: .infinity)
            .frame(height: 140) // 预留上下跳动的空间，按键变大不会挤动页面
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(state == .finishing)
    }
}


/// 列表里的图片、视频缩略图
struct Thumb: View {
    let name: String
    var body: some View {
        let dir = EntryStore.imagesDir
        let isVideo = name.hasSuffix(".mp4")
        let thumb = UIImage(contentsOfFile: dir.appendingPathComponent(MediaExporter.thumbName(for: name)).path)
            ?? (isVideo ? nil : UIImage(contentsOfFile: dir.appendingPathComponent(name).path))
        ZStack {
            if let thumb {
                Image(uiImage: thumb).resizable().scaledToFill()
            } else {
                Color.gray.opacity(0.2)
            }
            if isVideo {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white)
                    .shadow(radius: 3)
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
