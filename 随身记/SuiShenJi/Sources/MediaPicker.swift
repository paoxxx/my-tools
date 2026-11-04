import AVKit
import Photos
import SwiftUI

// MARK: - 相册数据

@MainActor
final class PhotoLibrary: ObservableObject {
    @Published var assets: [PHAsset] = []
    @Published var albums: [PHAssetCollection] = []
    @Published var title = "最近项目"
    @Published var status: PHAuthorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    let manager = PHCachingImageManager()

    func start() async {
        if status == .notDetermined {
            status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        guard status == .authorized || status == .limited else { return }
        loadAlbums()
        if let recents = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .smartAlbumUserLibrary, options: nil).firstObject {
            load(recents)
        }
    }

    /// 和微信一样：旧的在上面，新的在最下面
    func load(_ c: PHAssetCollection) {
        let o = PHFetchOptions()
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        o.predicate = NSPredicate(format: "mediaType == %d || mediaType == %d",
                                  PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let r = PHAsset.fetchAssets(in: c, options: o)
        var list: [PHAsset] = []
        list.reserveCapacity(r.count)
        r.enumerateObjects { a, _, _ in list.append(a) }
        assets = list
        title = c.localizedTitle ?? "相册"
    }

    private func loadAlbums() {
        var list: [PHAssetCollection] = []
        let smart: [PHAssetCollectionSubtype] = [.smartAlbumUserLibrary, .smartAlbumVideos, .smartAlbumScreenshots, .smartAlbumFavorites]
        for sub in smart {
            if let c = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: sub, options: nil).firstObject {
                list.append(c)
            }
        }
        PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
            .enumerateObjects { c, _, _ in list.append(c) }
        albums = list
    }
}

// MARK: - 仿微信选图面板

struct MediaPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var lib = PhotoLibrary()
    @State private var selected: [String] = []        // 按点选顺序记录
    @State private var original = false
    @State private var preview: PreviewSet?
    var onSend: ([PHAsset], Bool) -> Void

    private let cols = 4
    private let gap: CGFloat = 2

    var body: some View {
        VStack(spacing: 0) {
            topBar
            content
            bottomBar
        }
        .background(Color(white: 0.07).ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await lib.start() }
        .fullScreenCover(item: $preview) { set in
            MediaPreviewView(assets: set.assets, manager: lib.manager, selected: $selected,
                             original: $original, onSend: send)
        }
    }

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44)
            }
            Spacer()
            Menu {
                ForEach(lib.albums, id: \.localIdentifier) { c in
                    Button(c.localizedTitle ?? "相册") { lib.load(c) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(lib.title).font(.system(size: 17, weight: .semibold))
                    Image(systemName: "chevron.down.circle.fill").font(.system(size: 18))
                }
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(Capsule().fill(Color(white: 0.22)))
            }
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
    }

    @ViewBuilder private var content: some View {
        if lib.status == .denied || lib.status == .restricted {
            VStack(spacing: 12) {
                Spacer()
                Text("没有相册权限").font(.headline)
                Text("请到“设置→随身记→照片”里允许访问").font(.subheadline).foregroundStyle(.secondary)
                Button("去设置") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            GeometryReader { geo in
                let side = (geo.size.width - gap * CGFloat(cols - 1)) / CGFloat(cols)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: gap), count: cols), spacing: gap) {
                            ForEach(lib.assets, id: \.localIdentifier) { a in
                                AssetCell(asset: a, manager: lib.manager, side: side,
                                          order: selected.firstIndex(of: a.localIdentifier).map { $0 + 1 },
                                          onToggle: { toggle(a) },
                                          onOpen: { preview = PreviewSet(assets: [a]) })
                                    .id(a.localIdentifier)
                            }
                        }
                    }
                    .onChange(of: lib.assets.count) { _, _ in
                        if let last = lib.assets.last { proxy.scrollTo(last.localIdentifier, anchor: .bottom) }
                    }
                }
            }
        }
    }

    private var bottomBar: some View {
        HStack {
            Button("预览") { preview = PreviewSet(assets: selectedAssets) }
                .disabled(selected.isEmpty)
                .foregroundStyle(selected.isEmpty ? Color.gray : Color.white)
            Spacer()
            OriginalToggle(on: $original)
            Spacer()
            SendButton(count: selected.count) { send() }
        }
        .font(.system(size: 17))
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Color(white: 0.11).ignoresSafeArea(edges: .bottom))
    }

    private var selectedAssets: [PHAsset] {
        let map = Dictionary(lib.assets.map { ($0.localIdentifier, $0) }, uniquingKeysWith: { a, _ in a })
        let found = selected.compactMap { map[$0] }
        if found.count == selected.count { return found }
        let r = PHAsset.fetchAssets(withLocalIdentifiers: selected, options: nil)
        var byId: [String: PHAsset] = [:]
        r.enumerateObjects { a, _, _ in byId[a.localIdentifier] = a }
        return selected.compactMap { byId[$0] }
    }

    private func toggle(_ a: PHAsset) {
        if let i = selected.firstIndex(of: a.localIdentifier) {
            selected.remove(at: i)
        } else if selected.count < 9 {
            selected.append(a.localIdentifier)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func send() {
        let list = selectedAssets
        guard !list.isEmpty else { return }
        onSend(list, original)
        preview = nil
        dismiss()
    }
}

struct PreviewSet: Identifiable {
    let id = UUID()
    let assets: [PHAsset]
}

// MARK: - 网格里的一格

struct AssetCell: View {
    let asset: PHAsset
    let manager: PHCachingImageManager
    let side: CGFloat
    let order: Int?
    var onToggle: () -> Void
    var onOpen: () -> Void
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ZStack(alignment: .bottomLeading) {
                Group {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Color(white: 0.16)
                    }
                }
                .frame(width: side, height: side)
                .clipped()
                if order != nil { Color.black.opacity(0.3) }
                if asset.mediaType == .video {
                    HStack(spacing: 3) {
                        Image(systemName: "video.fill")
                        Text(durationText(asset.duration))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
                    .padding(5)
                }
            }
            .frame(width: side, height: side)
            .contentShape(Rectangle())
            .onTapGesture(perform: onOpen)

            SelectCircle(order: order)
                .padding(5)
                .frame(width: 44, height: 44, alignment: .topTrailing)
                .contentShape(Rectangle())
                .onTapGesture(perform: onToggle)
        }
        .frame(width: side, height: side)
        .onAppear(perform: load)
    }

    private func load() {
        guard image == nil else { return }
        let o = PHImageRequestOptions()
        o.deliveryMode = .opportunistic
        o.isNetworkAccessAllowed = true
        o.resizeMode = .fast
        let px = side * UIScreen.main.scale
        manager.requestImage(for: asset, targetSize: CGSize(width: px, height: px), contentMode: .aspectFill, options: o) { img, _ in
            if let img { image = img }
        }
    }
}

struct SelectCircle: View {
    let order: Int?
    var body: some View {
        ZStack {
            if let order {
                Circle().fill(Theme.gradient)
                Text("\(order)").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
            } else {
                Circle().fill(Color.black.opacity(0.15))
                Circle().strokeBorder(Color.white, lineWidth: 1.5)
            }
        }
        .frame(width: 24, height: 24)
        .shadow(color: .black.opacity(0.25), radius: 2)
    }
}

struct OriginalToggle: View {
    @Binding var on: Bool
    var body: some View {
        Button { on.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(on ? AnyShapeStyle(Theme.gradient) : AnyShapeStyle(Color.white))
                Text("原图").foregroundStyle(.white)
            }
        }
    }
}

struct SendButton: View {
    let count: Int
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(count == 0 ? "发送" : "发送(\(count))")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(count == 0 ? Color.gray : Color.white)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(count == 0 ? AnyShapeStyle(Color(white: 0.22)) : AnyShapeStyle(Theme.gradient))
                )
        }
        .disabled(count == 0)
    }
}

func durationText(_ t: TimeInterval) -> String {
    let s = Int(t.rounded())
    return String(format: "%d:%02d", s / 60, s % 60)
}

// MARK: - 预览

struct MediaPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    let assets: [PHAsset]
    let manager: PHCachingImageManager
    @Binding var selected: [String]
    @Binding var original: Bool
    var onSend: () -> Void
    @State private var page = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(assets.enumerated()), id: \.offset) { i, a in
                    PreviewPage(asset: a, manager: manager).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44)
                    }
                    Spacer()
                    Text(assets.count > 1 ? "\(page + 1)/\(assets.count)" : "").font(.headline)
                    Spacer()
                    if assets.indices.contains(page) {
                        let id = assets[page].localIdentifier
                        SelectCircle(order: selected.firstIndex(of: id).map { $0 + 1 })
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                if let i = selected.firstIndex(of: id) { selected.remove(at: i) }
                                else if selected.count < 9 { selected.append(id) }
                            }
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .background(Color.black.opacity(0.4))
                Spacer()
                HStack {
                    Spacer()
                    OriginalToggle(on: $original)
                    Spacer()
                    SendButton(count: selected.count) { onSend() }
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(Color.black.opacity(0.5))
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct PreviewPage: View {
    let asset: PHAsset
    let manager: PHCachingImageManager
    @State private var image: UIImage?
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if asset.mediaType == .video, let player {
                VideoPlayer(player: player)
            } else if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                ProgressView()
            }
        }
        .onAppear(perform: load)
        .onDisappear { player?.pause() }
    }

    private func load() {
        if asset.mediaType == .video {
            let o = PHVideoRequestOptions()
            o.isNetworkAccessAllowed = true
            manager.requestPlayerItem(forVideo: asset, options: o) { item, _ in
                guard let item else { return }
                DispatchQueue.main.async { player = AVPlayer(playerItem: item) }
            }
        } else {
            let o = PHImageRequestOptions()
            o.deliveryMode = .opportunistic
            o.isNetworkAccessAllowed = true
            let s = UIScreen.main.bounds.size
            let scale = UIScreen.main.scale
            manager.requestImage(for: asset, targetSize: CGSize(width: s.width * scale, height: s.height * scale),
                                 contentMode: .aspectFit, options: o) { img, _ in
                if let img { image = img }
            }
        }
    }
}

// MARK: - 导出：图片默认压缩、视频默认720P

enum MediaExporter {
    /// 返回存进App的文件名（图片.jpg / 视频.mp4），同时生成缩略图 thumb_文件名(.jpg)
    static func export(_ asset: PHAsset, original: Bool, baseName: String) async -> String? {
        asset.mediaType == .video
            ? await exportVideo(asset, original: original, baseName: baseName)
            : await exportImage(asset, original: original, baseName: baseName)
    }

    static func thumbName(for name: String) -> String {
        name.hasSuffix(".mp4") ? "thumb_\(name).jpg" : "thumb_\(name)"
    }

    private static func exportImage(_ asset: PHAsset, original: Bool, baseName: String) async -> String? {
        let o = PHImageRequestOptions()
        o.isNetworkAccessAllowed = true
        o.version = .current
        o.deliveryMode = .highQualityFormat
        let data: Data? = await withCheckedContinuation { cont in
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: o) { d, _, _, _ in
                cont.resume(returning: d)
            }
        }
        guard let data, let img = UIImage(data: data) else { return nil }
        let name = baseName + ".jpg"
        // 原图：保持原分辨率，转成JPG（Obsidian显示不了HEIC）；默认：最长边2048
        let full = original ? img : img.scaledDown(maxSide: 2048)
        guard let jpg = full.jpegData(compressionQuality: original ? 0.92 : 0.8) else { return nil }
        try? jpg.write(to: EntryStore.imagesDir.appendingPathComponent(name))
        if let t = img.scaledDown(maxSide: 240).jpegData(compressionQuality: 0.7) {
            try? t.write(to: EntryStore.imagesDir.appendingPathComponent(thumbName(for: name)))
        }
        return name
    }

    private static func exportVideo(_ asset: PHAsset, original: Bool, baseName: String) async -> String? {
        let o = PHVideoRequestOptions()
        o.isNetworkAccessAllowed = true
        o.deliveryMode = .highQualityFormat
        let preset = original ? AVAssetExportPresetHighestQuality : AVAssetExportPreset1280x720
        let session: AVAssetExportSession? = await withCheckedContinuation { cont in
            PHImageManager.default().requestExportSession(forVideo: asset, options: o, exportPreset: preset) { s, _ in
                cont.resume(returning: s)
            }
        }
        guard let session else { return nil }
        let name = baseName + ".mp4"
        let url = EntryStore.imagesDir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        session.outputURL = url
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { cont.resume() }
        }
        guard session.status == .completed else { return nil }
        // 封面：第一帧
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 480, height: 480)
        if let cg = try? await gen.image(at: .zero).image,
           let t = UIImage(cgImage: cg).jpegData(compressionQuality: 0.7) {
            try? t.write(to: EntryStore.imagesDir.appendingPathComponent(thumbName(for: name)))
        }
        return name
    }
}
