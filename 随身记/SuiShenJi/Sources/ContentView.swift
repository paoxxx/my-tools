import SwiftUI
import UIKit
import Photos

struct ContentView: View {
    @EnvironmentObject var model: RecorderModel
    @State private var showSettings = false
    @State private var copiedID: UUID?
    @State private var showPicker = false
    @State private var detailID: UUID?
    @State private var showQuick = false

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
            .navigationDestination(item: $detailID) { id in
                EntryDetailView(id: id).environmentObject(model)
            }
            .fullScreenCover(isPresented: $showQuick) {
                QuickInputView().environmentObject(model)
            }
            .onAppear { model.onAppear(); openQuickIfRequested() }
            .onReceive(NotificationCenter.default.publisher(for: .startRecordingRequested)) { _ in
                model.checkPendingStart()
                openQuickIfRequested()
            }
            .onChange(of: model.quickRequested) { _, _ in openQuickIfRequested() }
        }
    }

    private func openQuickIfRequested() {
        if model.quickRequested {
            model.quickRequested = false
            showQuick = true
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
        let cal = Calendar.current
        let now = Date()
        let thisYear = cal.component(.year, from: now)
        let thisMonth = cal.date(from: cal.dateComponents([.year, .month], from: now))!
        let history = model.history
        let monthNow = history.first { $0.year == thisYear }?.months.first { $0.month == thisMonth }
        let otherMonths = history.first { $0.year == thisYear }?.months.filter { $0.month != thisMonth } ?? []
        let pastYears = history.filter { $0.year != thisYear }
        return List {
            if model.entries.isEmpty {
                Text("点下面的按钮快捷输入，用键盘上的“点击说话”语音输入；也可以设置成按侧边的操作按钮直接打开输入。")
                    .foregroundStyle(.secondary)
            }
            if !model.todayEntries.isEmpty {
                Section {
                    ForEach(model.todayEntries) { row($0, showDate: false) }
                } header: {
                    Text("今天")
                } footer: {
                    Text(model.lastRefresh.map { "下拉刷新同步状态 · 上次刷新 \(DateFormatter.time.string(from: $0))" } ?? "下拉刷新同步状态 · 左滑可以删除")
                }
            }
            // 本月：按天
            if let monthNow {
                Section("本月") {
                    ForEach(monthNow.days) { dayGroup($0, expanded: cal.isDateInYesterday($0.day)) }
                }
            }
            // 今年其他月：月里面再按天
            if !otherMonths.isEmpty {
                Section("今年") {
                    ForEach(otherMonths) { m in
                        DisclosureGroup {
                            ForEach(m.days) { dayGroup($0, expanded: false) }
                        } label: {
                            groupLabel(DateFormatter.month.string(from: m.month), count: m.count)
                        }
                    }
                }
            }
            // 往年：年→月→天
            ForEach(pastYears) { y in
                Section("\(String(y.year))年") {
                    ForEach(y.months) { m in
                        DisclosureGroup {
                            ForEach(m.days) { dayGroup($0, expanded: false) }
                        } label: {
                            groupLabel(DateFormatter.month.string(from: m.month), count: m.count)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
    }

    private func dayGroup(_ d: DayGroup, expanded: Bool) -> some View {
        DayDisclosure(initiallyExpanded: expanded) {
            ForEach(d.entries) { row($0, showDate: false) }
        } label: {
            groupLabel(dayTitle(d.day), count: d.entries.count)
        }
    }

    private func groupLabel(_ title: String, count: Int) -> some View {
        HStack {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text("\(count)条").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func dayTitle(_ d: Date) -> String {
        let base = DateFormatter.dayTitle.string(from: d)
        return Calendar.current.isDateInYesterday(d) ? "昨天 " + base : base
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
                    .lineLimit(4)   // 列表里只预览，全文点进去看
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
                Label(e.text.isEmpty ? "点开查看，继续补充说明" : "点开查看，继续补充说明", systemImage: "mic.badge.plus")
                    .font(.caption)
                    .foregroundStyle(Theme.pink)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                model.delete(e.id)
            } label: {
                Label("删除", systemImage: "trash")
            }
        }
        .onTapGesture {
            guard model.state == .idle else { return }
            detailID = e.id   // 点任意一条：进入查看页，并自动开始补充录音
        }
        .contextMenu {
            if !e.text.isEmpty {
                Button {
                    UIPasteboard.general.string = e.text
                    copiedID = e.id
                } label: { Label("复制文字", systemImage: "doc.on.doc") }
            }
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

                QuickInputButton(title: "快捷输入") { showQuick = true }
                    .disabled(model.state != .idle)
                    .frame(width: geo.size.width - gap - photoW)
            }
        }
        .frame(height: 100)
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
    var idleTitle = "点击说话"
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
                    Text(state == .finishing ? "正在定稿…" : (recording ? "点击停止" : idleTitle))
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
    var size: CGFloat = 72
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
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}


/// 可以记住初始展开状态的折叠组（昨天默认展开）
struct DayDisclosure<Content: View, Label: View>: View {
    @State private var expanded: Bool
    let content: () -> Content
    let label: () -> Label

    init(initiallyExpanded: Bool, @ViewBuilder content: @escaping () -> Content, @ViewBuilder label: @escaping () -> Label) {
        _expanded = State(initialValue: initiallyExpanded)
        self.content = content
        self.label = label
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded, content: content, label: label)
    }
}


/// 底部大键：点一下直接进入打字界面
struct QuickInputButton: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Capsule()
                    .fill(Theme.gradient)
                    .frame(height: 64)
                    .shadow(color: Theme.pink.opacity(0.3), radius: 8, y: 4)
                HStack(spacing: 10) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 22, weight: .semibold))
                    Text(title)
                        .font(.system(size: 18, weight: .semibold))
                }
                .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 100)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }
}


/// 快捷输入：点按钮直接出光标和键盘，用输入法（比如豆包输入法的“点击说话”）输入；点空白处保存并返回
struct QuickInputView: View {
    @EnvironmentObject var model: RecorderModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var startDate = Date()
    @State private var saved = false
    @FocusState private var focused: Bool

    private static let draftKey = "quickDraftText"
    private static let draftDateKey = "quickDraftDate"

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(DateFormatter.full.string(from: startDate))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("完成") { finish() }
                        .fontWeight(.semibold)
                        .foregroundStyle(Theme.pink)
                }
                TextEditor(text: $text)
                    .font(.body)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .frame(height: 220)
                    .padding(8)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                    .onChange(of: text) { _, v in UserDefaults.standard.set(v, forKey: Self.draftKey) }
            }
            .padding()

            // 下面整片空白：点一下保存并返回
            ZStack {
                Color.clear
                Text("点这里空白处，保存并返回")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { finish() }
            // 在空白处横着滑一下也保存并返回
            .gesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { v in
                        if abs(v.translation.width) > 60 && abs(v.translation.width) > abs(v.translation.height) { finish() }
                    }
            )
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        // 从屏幕左边缘往右滑：保存并返回（和其他页面的返回手势一致）
        .overlay(alignment: .leading) {
            Color.clear
                .frame(width: 28)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onEnded { v in
                            if v.translation.width > 60 && abs(v.translation.width) > abs(v.translation.height) { finish() }
                        }
                )
        }
        .onAppear {
            // 上次没来得及保存的草稿，接着写
            if let d = UserDefaults.standard.string(forKey: Self.draftKey), !d.isEmpty {
                text = d
                let t = UserDefaults.standard.double(forKey: Self.draftDateKey)
                if t > 0 { startDate = Date(timeIntervalSince1970: t) }
            } else {
                UserDefaults.standard.set(startDate.timeIntervalSince1970, forKey: Self.draftDateKey)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { focused = true }
        }
        .onDisappear { finish() }
    }

    private func finish() {
        guard !saved else { return }
        saved = true
        focused = false
        model.addText(text, date: startDate)
        UserDefaults.standard.removeObject(forKey: Self.draftKey)
        UserDefaults.standard.removeObject(forKey: Self.draftDateKey)
        dismiss()
    }
}
