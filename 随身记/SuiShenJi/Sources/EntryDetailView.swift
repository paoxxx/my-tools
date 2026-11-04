import AVKit
import SwiftUI
import UIKit

/// 查看一条已收录的随身记：进来就自动开始补充录音；点停止只停录音、留在这页；左上角返回回到列表
struct EntryDetailView: View {
    let id: UUID
    @EnvironmentObject var model: RecorderModel
    @Environment(\.dismiss) private var dismiss
    @State private var viewer: ViewerStart?
    @State private var editing = false
    @State private var didAutoStart = false
    @State private var wantEdit = false
    @State private var draft = ""
    @State private var original = ""
    @State private var autosaved = false
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var entry: Entry? { model.entries.first { $0.id == id } }
    /// 现在的录音是不是在给这一条补充
    private var isMine: Bool { model.captionTarget == id && model.state != .idle }

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let e = entry {
                            Text(DateFormatter.full.string(from: e.date))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)

                            if !e.imageNames.isEmpty {
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                                    ForEach(Array(e.imageNames.enumerated()), id: \.offset) { i, name in
                                        GeometryReader { g in
                                            Thumb(name: name, size: g.size.width)
                                        }
                                        .aspectRatio(1, contentMode: .fit)
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            model.stopIfRecording()   // 看大图看视频时先停录音
                                            viewer = ViewerStart(names: e.imageNames, index: i)
                                        }
                                    }
                                }
                            }

                            if editing {
                                HStack {
                                    Button("撤销修改") {
                                        draft = original
                                        finishEdit()
                                    }
                                    .foregroundStyle(.secondary)
                                    Spacer()
                                    if autosaved {
                                        Text("已自动保存").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button("完成") { finishEdit() }
                                        .fontWeight(.semibold)
                                        .foregroundStyle(Theme.pink)
                                }
                                TextEditor(text: $draft)
                                    .font(.body)
                                    .onChange(of: draft) { _, _ in scheduleAutosave() }
                                    .focused($focused)
                                    .frame(minHeight: 260)
                                    .scrollContentBackground(.hidden)
                                    .padding(8)
                                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                            } else if e.text.isEmpty && !isMine {
                                Text("还没有文字，点下面的按钮输入补充。")
                                    .foregroundStyle(.secondary)
                            } else if !e.text.isEmpty {
                                Text(e.text)
                                    .font(.body)
                                    .lineSpacing(5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                    .onTapGesture(count: 2) { beginEdit() }   // 双击文字进入编辑
                            }
                            if !editing && !e.text.isEmpty {
                                Text("双击文字可以编辑")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        // 正在补充的内容
                        if isMine {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 6) {
                                    Circle().fill(.red).frame(width: 8, height: 8)
                                    Text(model.state == .recording ? "正在补充  \(timeString(model.elapsed))" : "正在定稿…")
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                                Text(model.liveText.isEmpty ? "说吧，我在听。" : model.liveText)
                                    .font(.body)
                                    .foregroundStyle(model.liveText.isEmpty ? .secondary : .primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(14)
                            .background(Theme.pink.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                            .id("live")
                            if model.state == .recording {
                                Text("点空白处停止")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }
                    .padding()
                    .padding(.bottom, 24)
                    // 内容不满一屏时也撑满，空白处都能点
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .topLeading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        // 录音时点任意空白处停止（点图片会打开大图，双击文字会进入编辑）
                        if editing { finishEdit() }   // 输入时点空白处：保存，留在这一页
                    }
                }
                .onChange(of: model.liveText) { _, _ in
                    withAnimation { proxy.scrollTo("live", anchor: .bottom) }
                }
            }
            }

            if !editing {
            QuickInputButton(title: "继续输入") { openEditor(appendLine: true) }
            .frame(height: 100)
            .padding(.horizontal, 20)
            .padding(.bottom, 28)   // 按钮往上提一些，离屏幕底边远一点
            }
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .onChange(of: model.state) { _, st in
            // 双击时正在录音：先等录音定稿，再进入编辑，补充的话不会丢
            if wantEdit && st == .idle { wantEdit = false; openEditor() }
        }
        .toolbar(.hidden, for: .navigationBar)   // 不要顶部栏，界面更干净；从屏幕左边缘右滑返回
        .onDisappear {
            if editing { finishEdit() }   // 编辑中左滑返回：直接保存
            if isMine && model.state == .recording { model.stop() }  // 返回时把正在录的存好
        }
        .onAppear {
            // 进来只查看，点“继续输入”才出键盘
        }
        .fullScreenCover(item: $viewer) { v in
            MediaViewer(names: v.names, start: v.index)
        }
    }

    private func beginEdit() {
        if isMine {
            wantEdit = true
            if model.state == .recording { model.stop() }
        } else {
            openEditor()
        }
    }

    /// 停止输入0.6秒就先存到手机里（不等点完成），离开时再同步给电脑
    private func scheduleAutosave() {
        saveTask?.cancel()
        let text = draft
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled, editing else { return }
            model.saveDraft(id, text: text)
            autosaved = true
        }
    }

    /// 结束编辑：保存并同步给电脑
    private func finishEdit() {
        saveTask?.cancel()
        // 没改过就不动；改过（包括已经自动保存过）就保存并同步
        if draft != original || autosaved {
            model.updateText(id, text: draft)
        }
        editing = false
        focused = false
        autosaved = false
    }

    private func openEditor(appendLine: Bool = false) {
        let base = entry?.text ?? ""
        draft = (appendLine && !base.isEmpty) ? base + "\n" : base
        original = base
        autosaved = false
        editing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { focused = true }
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

struct ViewerStart: Identifiable {
    let id = UUID()
    let names: [String]
    let index: Int
}

/// 全屏看图、看视频：左右滑切换；图片点一下或往下拖关闭，视频往下拖或点左上角小叉关闭
struct MediaViewer: View {
    let names: [String]
    let start: Int
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0
    @State private var dragY: CGFloat = 0

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(1 - min(0.6, Double(abs(dragY)) / 400)).ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(names.enumerated()), id: \.offset) { i, name in
                    MediaPage(name: name, onTap: { dismiss() }).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: names.count > 1 ? .always : .never))
            .offset(y: dragY)
            // 视频：单击是调出播放控件，所以收起靠左上角小叉或往下拖
            if names.indices.contains(page), names[page].hasSuffix(".mp4") {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Color.black.opacity(0.45)))
                }
                .padding(.leading, 16)
                .padding(.top, 8)
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 20)
                .onChanged { v in
                    if abs(v.translation.height) > abs(v.translation.width) { dragY = v.translation.height }
                }
                .onEnded { v in
                    if abs(v.translation.height) > 120 && abs(v.translation.height) > abs(v.translation.width) {
                        dismiss()
                    } else {
                        withAnimation(.spring(response: 0.25)) { dragY = 0 }
                    }
                }
        )
        .onAppear { page = start }
        .preferredColorScheme(.dark)
    }
}

struct MediaPage: View {
    let name: String
    var onTap: () -> Void = {}
    @State private var player: AVPlayer?
    @State private var scale: CGFloat = 1

    var body: some View {
        let url = EntryStore.imagesDir.appendingPathComponent(name)
        Group {
            if name.hasSuffix(".mp4") {
                // 视频保留系统播放控件：播放、暂停、进度条
                VideoPlayer(player: player)
                    .onAppear {
                        if player == nil { player = AVPlayer(url: url) }
                        player?.play()
                    }
                    .onDisappear { player?.pause() }
            } else if let img = UIImage(contentsOfFile: url.path) {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: onTap)   // 点图片任意位置回到上一页
                    .gesture(MagnificationGesture()
                        .onChanged { scale = max(1, $0) }
                        .onEnded { _ in withAnimation { scale = 1 } })
            } else {
                Text("文件不在手机上").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: onTap)
            }
        }
    }
}


/// 隐藏顶部栏以后，系统默认会把“从左边缘右滑返回”也关掉，这里把它打开
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}


/// 不带控件的视频画面
struct VideoSurface: UIViewRepresentable {
    let player: AVPlayer?

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> PlayerView {
        let v = PlayerView()
        v.playerLayer.videoGravity = .resizeAspect
        v.backgroundColor = .clear
        return v
    }

    func updateUIView(_ v: PlayerView, context: Context) {
        v.playerLayer.player = player
    }
}
