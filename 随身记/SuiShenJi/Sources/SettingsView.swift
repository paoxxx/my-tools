import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: RecorderModel
    @Environment(\.dismiss) private var dismiss

    @State private var appID = AppSettings.appID
    @State private var token = AppSettings.accessToken
    @State private var resourceID = AppSettings.resourceID
    @State private var folderName = ObsidianWriter.folderName
    @State private var picking = false
    @State private var hotwordCount = AppSettings.cachedHotwords.count
    @State private var note: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("App ID", text: $appID)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Access Token", text: $token)
                    TextField("资源ID", text: $resourceID)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("豆包语音（火山引擎）")
                } footer: {
                    Text("ID和密钥存在手机钥匙串里。额度用完可以直接换一组。资源ID默认是流式识别2.0小时版：\(AppSettings.defaultResourceID)")
                }

                Section {
                    Button(folderName.map { "当前文件夹：\($0)" } ?? "选择Obsidian里的随身记文件夹") {
                        picking = true
                    }
                    Button("立即同步") {
                        model.sync()
                        note = model.syncMessage ?? "没有待同步的记录"
                    }
                } header: {
                    Text("Obsidian")
                } footer: {
                    Text("在“文件”里依次选：iCloud云盘→Obsidian→Notes→1.日记和待办→随身记。")
                }

                Section {
                    Button("重新读取词库（当前\(hotwordCount)个词）") {
                        hotwordCount = model.refreshHotwords()
                        note = "词库已更新，共\(hotwordCount)个词"
                    }
                } header: {
                    Text("词库")
                } footer: {
                    Text("读取随身记文件夹里的“词库.md”，录音时作为热词发给豆包，减少错字。")
                }

                Section("签名") {
                    if let d = SigningInfo.expirationDate {
                        Text("到期时间：\(DateFormatter.full.string(from: d))")
                    } else {
                        Text("读取不到到期时间")
                    }
                }

                if let note {
                    Section { Text(note).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        AppSettings.appID = appID
                        AppSettings.accessToken = token
                        AppSettings.resourceID = resourceID
                        dismiss()
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
                switch result {
                case .success(let url):
                    do {
                        try ObsidianWriter.saveFolder(url)
                        folderName = ObsidianWriter.folderName
                        hotwordCount = model.refreshHotwords()
                        model.sync()
                        note = "已选择文件夹：\(url.lastPathComponent)"
                    } catch {
                        note = "保存文件夹失败：\(error.localizedDescription)"
                    }
                case .failure(let error):
                    note = "选择失败：\(error.localizedDescription)"
                }
            }
        }
    }
}
