import Foundation

/// 豆包流式语音识别（大模型，双向流式优化版）
/// 协议：WebSocket ＋ 4字节二进制头，音频为16k、16bit、单声道PCM
final class DoubaoASR: NSObject, URLSessionWebSocketDelegate {

    struct Config {
        var appID: String
        var accessToken: String
        var resourceID: String
        var hotwords: [String]
    }

    /// 识别到的全部文字（第一遍＋二遍修正后的完整结果），在后台线程回调
    var onText: ((String) -> Void)?
    /// 出错，在后台线程回调
    var onError: ((String) -> Void)?

    private let endpoint = URL(string: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async")!
    private let queue = DispatchQueue(label: "suishenji.asr")
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var isOpen = false
    private var pending: [Data] = []
    private var latestText = ""
    private var finishHandler: ((String) -> Void)?
    private var finishTimer: DispatchWorkItem?
    private var closed = false

    // MARK: - 启动

    func start(_ config: Config) {
        var request = URLRequest(url: endpoint)
        request.setValue(config.appID, forHTTPHeaderField: "X-Api-App-Key")
        request.setValue(config.accessToken, forHTTPHeaderField: "X-Api-Access-Key")
        request.setValue(config.resourceID, forHTTPHeaderField: "X-Api-Resource-Id")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Api-Connect-Id")
        request.timeoutInterval = 15

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.webSocketTask(with: request)
        self.task = task

        // 第一包：配置
        var req: [String: Any] = [
            "model_name": "bigmodel",
            "enable_itn": true,        // 数字转成阿拉伯数字
            "enable_punc": true,       // 自动加标点
            "enable_ddc": false,       // 不删语气词，保留原话
            "enable_nonstream": true,  // 二遍识别：一句说完后用整句再识别一遍，修正前面的错字
            "show_utterances": true,
            "result_type": "full"
        ]
        let words = config.hotwords.filter { !$0.isEmpty }.prefix(200)
        if !words.isEmpty {
            let hot = ["hotwords": words.map { ["word": $0] }]
            if let d = try? JSONSerialization.data(withJSONObject: hot),
               let s = String(data: d, encoding: .utf8) {
                req["corpus"] = ["context": s]
            }
        }
        let payload: [String: Any] = [
            "user": ["uid": "suishenji"],
            "audio": ["format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1],
            "request": req
        ]
        let json = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()

        queue.async {
            self.pending.append(Self.frame(type: 0x1, flags: 0x0, serialization: 0x1, payload: json))
        }
        task.resume()
        receiveLoop()
    }

    // MARK: - 发送音频

    func sendAudio(_ pcm: Data) {
        queue.async {
            self.enqueue(Self.frame(type: 0x2, flags: 0x0, serialization: 0x0, payload: pcm))
        }
    }

    /// 发送最后一包并等待最终结果
    func finish(lastChunk: Data, completion: @escaping (String) -> Void) {
        queue.async {
            self.finishHandler = completion
            self.enqueue(Self.frame(type: 0x2, flags: 0x2, serialization: 0x0, payload: lastChunk))
            // 最多等6秒，拿不到最终包就用已有结果
            let work = DispatchWorkItem { [weak self] in self?.complete() }
            self.finishTimer = work
            self.queue.asyncAfter(deadline: .now() + 6, execute: work)
        }
    }

    func cancel() {
        queue.async {
            self.finishHandler = nil
            self.close()
        }
    }

    // MARK: - 内部

    private func enqueue(_ frame: Data) {
        if isOpen {
            task?.send(.data(frame)) { [weak self] error in
                if let error { self?.report("发送失败：\(error.localizedDescription)") }
            }
        } else {
            pending.append(frame)
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        queue.async {
            self.isOpen = true
            let frames = self.pending
            self.pending.removeAll()
            for f in frames { self.enqueue(f) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.async {
            if let error, !self.closed {
                var msg = error.localizedDescription
                if let http = task.response as? HTTPURLResponse {
                    msg = "连接失败（HTTP \(http.statusCode)）。请检查App ID、Access Token和资源ID是否正确，以及流式识别服务是否已开通。"
                    if let logid = http.value(forHTTPHeaderField: "X-Tt-Logid") { msg += " logid：\(logid)" }
                }
                self.report(msg)
            }
            self.complete()
        }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .data(let data) = message {
                    self.queue.async { self.handle(data) }
                }
                self.receiveLoop()
            case .failure:
                break // 由 didCompleteWithError 统一处理
            }
        }
    }

    private func handle(_ data: Data) {
        let b = [UInt8](data)
        guard b.count >= 4 else { return }
        let headerSize = Int(b[0] & 0x0F) * 4
        let type = b[1] >> 4
        let flags = b[1] & 0x0F
        var i = headerSize

        if type == 0xF { // 错误包
            guard b.count >= i + 8 else { return }
            let code = Self.u32(b, i)
            let size = Int(Self.u32(b, i + 4))
            let end = min(b.count, i + 8 + size)
            let msg = String(bytes: b[(i + 8)..<end], encoding: .utf8) ?? ""
            report("识别服务报错（\(code)）：\(msg)")
            complete()
            return
        }
        guard type == 0x9 else { return }
        if flags & 0x1 != 0 { i += 4 } // 带序号
        guard b.count >= i + 4 else { return }
        let size = Int(Self.u32(b, i)); i += 4
        guard b.count >= i + size else { return }
        let payload = Data(b[i..<(i + size)])

        if let obj = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
           let result = obj["result"] as? [String: Any],
           let text = result["text"] as? String {
            latestText = text
            onText?(text)
        }
        if flags & 0x2 != 0 { // 最后一包
            complete()
        }
    }

    private func complete() {
        finishTimer?.cancel()
        finishTimer = nil
        if let h = finishHandler {
            finishHandler = nil
            let text = latestText
            h(text)
        }
        close()
    }

    private func close() {
        guard !closed else { return }
        closed = true
        task?.cancel(with: .normalClosure, reason: nil)
        session?.finishTasksAndInvalidate()
    }

    private func report(_ msg: String) {
        guard !closed else { return }
        onError?(msg)
    }

    // MARK: - 二进制协议

    static func frame(type: UInt8, flags: UInt8, serialization: UInt8, payload: Data) -> Data {
        var d = Data([0x11, (type << 4) | flags, (serialization << 4) | 0x0, 0x00])
        let n = UInt32(payload.count)
        d.append(contentsOf: [UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF)])
        d.append(payload)
        return d
    }

    static func u32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) << 24 | UInt32(b[i + 1]) << 16 | UInt32(b[i + 2]) << 8 | UInt32(b[i + 3])
    }
}
