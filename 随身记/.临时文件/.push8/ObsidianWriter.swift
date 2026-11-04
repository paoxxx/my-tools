import Foundation

/// 把录音文字送进Obsidian：手机只往“_收件箱”里放一条一个的小文件，
/// Mac后台程序把它们合并进当天笔记。手机和Mac不会同时改同一个文件，避免iCloud冲突丢内容。
enum ObsidianWriter {
    static let inboxName = ".收件箱"   // 点开头的文件夹Obsidian不显示
    static let oldInboxName = "_收件箱"
    private static let bookmarkKey = "obsidianFolderBookmark"

    // MARK: 文件夹授权

    static var folderName: String? {
        guard let url = resolveFolder() else { return nil }
        return url.lastPathComponent
    }

    static func saveFolder(_ url: URL) throws {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(data, forKey: bookmarkKey)
    }

    static func resolveFolder() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale { try? saveFolder(url) }
        return url
    }

    // MARK: 同步

    /// 把没送出的记录写进收件箱，返回成功条数；失败的下次再试
    @discardableResult
    static func syncPending() -> Result<Int, Error> {
        let pending = EntryStore.shared.unsynced
        guard !pending.isEmpty else { return .success(0) }
        guard let folder = resolveFolder() else {
            return .failure(NSError(domain: "Obsidian", code: 1, userInfo: [NSLocalizedDescriptionKey: "还没选择Obsidian文件夹"]))
        }
        let ok = folder.startAccessingSecurityScopedResource()
        defer { if ok { folder.stopAccessingSecurityScopedResource() } }

        let inbox = folder.appendingPathComponent(inboxName, isDirectory: true)
        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        var count = 0
        for e in pending {
            do {
                let name = try write(e, to: inbox)
                EntryStore.shared.markSynced(e.id, fileName: inboxName + "/" + name)
                count += 1
            } catch {
                return count > 0 ? .success(count) : .failure(error)
            }
        }
        return .success(count)
    }

    private static func write(_ e: Entry, to inbox: URL) throws -> String {
        let name = DateFormatter.fileStamp.string(from: e.date) + "_" + String(e.id.uuidString.prefix(4)) + ".md"
        let file = inbox.appendingPathComponent(name)
        // 图片先放进“附件”文件夹，笔记里用![[文件名]]引用
        if !e.imageNames.isEmpty {
            let attach = inbox.deletingLastPathComponent().appendingPathComponent("附件", isDirectory: true)
            try? FileManager.default.createDirectory(at: attach, withIntermediateDirectories: true)
            for img in e.imageNames {
                let src = EntryStore.imagesDir.appendingPathComponent(img)
                guard let data = try? Data(contentsOf: src) else { continue }
                let dst = attach.appendingPathComponent(img)
                var ce: NSError?
                var we: Error?
                NSFileCoordinator().coordinate(writingItemAt: dst, options: .forReplacing, error: &ce) { url in
                    do { try data.write(to: url, options: .atomic) } catch { we = error }
                }
                if let ce { throw ce }
                if let we { throw we }
            }
        }
        var body = "time: \(DateFormatter.full.string(from: e.date))\n"
        if !e.imageNames.isEmpty { body += "images: " + e.imageNames.joined(separator: ", ") + "\n" }
        body += "\n\(e.text)\n"
        var coordError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &coordError) { url in
            do { try body.write(to: url, atomically: true, encoding: .utf8) }
            catch { writeError = error }
        }
        if let coordError { throw coordError }
        if let writeError { throw writeError }
        return name
    }

    /// 检查哪些记录电脑已经合并：收件箱里的小文件被电脑删掉了，就算收到。返回新确认的条数
    @discardableResult
    static func checkMerged() -> Int {
        let waiting = EntryStore.shared.entries.filter { $0.isSent && !$0.isMerged && $0.fileName != nil }
        guard !waiting.isEmpty, let folder = resolveFolder() else { return 0 }
        let ok = folder.startAccessingSecurityScopedResource()
        defer { if ok { folder.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        var done = Set<UUID>()
        for e in waiting {
            guard let stored = e.fileName else { continue }
            let rel = stored.contains("/") ? stored : oldInboxName + "/" + stored
            let parts = rel.split(separator: "/", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            let dir = folder.appendingPathComponent(parts[0], isDirectory: true)
            guard fm.fileExists(atPath: dir.path) || parts[0] == oldInboxName else { continue }
            let file = dir.appendingPathComponent(parts[1]).path
            let placeholder = dir.appendingPathComponent("." + parts[1] + ".icloud").path
            if !fm.fileExists(atPath: file) && !fm.fileExists(atPath: placeholder) {
                done.insert(e.id)
            }
        }
        EntryStore.shared.markMerged(done)
        return done.count
    }

    // MARK: 词库

    /// 读取文件夹里的“词库.md”，每行“- 词”或“- 错误写法 → 正确写法”，取正确写法当热词
    static func loadHotwords() -> [String] {
        guard let folder = resolveFolder() else { return AppSettings.cachedHotwords }
        let ok = folder.startAccessingSecurityScopedResource()
        defer { if ok { folder.stopAccessingSecurityScopedResource() } }
        let file = folder.appendingPathComponent("词库.md")
        var text: String?
        var err: NSError?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &err) { url in
            text = try? String(contentsOf: url, encoding: .utf8)
        }
        guard let text else { return AppSettings.cachedHotwords }

        var words: [String] = []
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("- ") else { continue }
            var w = String(line.dropFirst(2))
            for arrow in ["→", "->", "=>"] {
                if let r = w.range(of: arrow) { w = String(w[r.upperBound...]) }
            }
            w = w.trimmingCharacters(in: .whitespaces)
            if !w.isEmpty && !words.contains(w) { words.append(w) }
        }
        AppSettings.cachedHotwords = words
        return words
    }
}

extension DateFormatter {
    static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static let full: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()
    static let time: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "HH:mm:ss"
        return f
    }()
    static let fileStamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return f
    }()
}
