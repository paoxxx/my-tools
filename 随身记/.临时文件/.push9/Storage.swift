import Foundation
import Security

// MARK: - 钥匙串：存豆包的ID和密钥

enum Keychain {
    static func set(_ value: String, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrAccount as String: key,
                                   kSecAttrService as String: "suishenji"]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrAccount as String: key,
                                kSecAttrService as String: "suishenji",
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let d = out as? Data else { return "" }
        return String(data: d, encoding: .utf8) ?? ""
    }
}

// MARK: - 一条录音

struct Entry: Codable, Identifiable, Equatable {
    var id = UUID()
    var date: Date
    var text: String
    var synced = false
    /// 新版：是否已放进Obsidian收件箱（旧版记录为nil，升级后会重新送一次，Mac端按时间去重）
    var sent: Bool? = nil
    /// 收件箱里的文件名；电脑合并后会被删掉，据此判断“电脑已收到”
    var fileName: String? = nil
    var merged: Bool? = nil
    /// 附带的图片（存在手机App的images文件夹里的文件名）
    var images: [String]? = nil
    var imageNames: [String] { images ?? [] }
    /// 已上传之后又补录的说明，还没发给电脑的
    var pendingCaptions: [String]? = nil
    var hasPendingCaption: Bool { !(pendingCaptions ?? []).isEmpty }
    var isSent: Bool { sent == true }
    var isMerged: Bool { merged == true }
}

// MARK: - 本地存储：先存手机，再同步Obsidian，保证不丢

final class EntryStore {
    static let shared = EntryStore()
    private(set) var entries: [Entry] = []
    private let url: URL

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("entries.json")
        if let d = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode([Entry].self, from: d) {
            entries = list
        }
    }

    static let imagesDir: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("images", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    func add(_ e: Entry) {
        entries.append(e)
        save()
    }

    func markSynced(_ id: UUID, fileName: String) {
        if let i = entries.firstIndex(where: { $0.id == id }) {
            entries[i].synced = true
            entries[i].sent = true
            entries[i].fileName = fileName
            entries[i].pendingCaptions = nil
            entries[i].merged = false
            save()
        }
    }

    /// 给已有记录（比如图片）补一段语音说明
    func appendCaption(_ id: UUID, text: String) {
        guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[i].text = entries[i].text.isEmpty ? text : entries[i].text + "\n" + text
        if entries[i].isSent {
            entries[i].pendingCaptions = (entries[i].pendingCaptions ?? []) + [text]
        }
        save()
    }

    func markMerged(_ ids: Set<UUID>) {
        guard !ids.isEmpty else { return }
        for i in entries.indices where ids.contains(entries[i].id) {
            entries[i].merged = true
        }
        save()
    }

    var unsynced: [Entry] { entries.filter { !$0.isSent || $0.hasPendingCaption }.sorted { $0.date < $1.date } }

    private func save() {
        if let d = try? JSONEncoder().encode(entries) {
            try? d.write(to: url, options: .atomic)
        }
    }
}

// MARK: - 设置

enum AppSettings {
    static let defaultResourceID = "volc.seedasr.sauc.duration"

    static var appID: String {
        get { Keychain.get("appID") }
        set { Keychain.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), for: "appID") }
    }
    static var accessToken: String {
        get { Keychain.get("accessToken") }
        set { Keychain.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), for: "accessToken") }
    }
    static var resourceID: String {
        get {
            let v = UserDefaults.standard.string(forKey: "resourceID") ?? ""
            return v.isEmpty ? defaultResourceID : v
        }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "resourceID") }
    }
    static var cachedHotwords: [String] {
        get { UserDefaults.standard.stringArray(forKey: "hotwords") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "hotwords") }
    }
    static var isConfigured: Bool { !appID.isEmpty && !accessToken.isEmpty }
}
