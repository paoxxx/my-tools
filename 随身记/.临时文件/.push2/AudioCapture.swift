import AVFoundation

/// 麦克风采集，输出16k、16bit、单声道PCM，每200毫秒一包
final class AudioCapture {
    var onChunk: ((Data) -> Void)?
    var onLevel: ((Float) -> Void)?

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    private let queue = DispatchQueue(label: "suishenji.audio")
    private var buffer = Data()
    private let chunkBytes = 6400 // 200毫秒

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers])
        try session.setActive(true)

        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0 else {
            throw NSError(domain: "AudioCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有可用的麦克风"])
        }
        converter = AVAudioConverter(from: inFormat, to: target)
        queue.sync { buffer = Data() }

        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buf, _ in
            self?.process(buf)
        }
        engine.prepare()
        try engine.start()
    }

    /// 停止采集，返回还没发出去的最后一点音频
    func stop() -> Data {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return queue.sync { () -> Data in
            let rest = buffer
            buffer = Data()
            return rest
        }
    }

    private func process(_ buf: AVAudioPCMBuffer) {
        guard let converter else { return }
        let ratio = target.sampleRate / buf.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }

        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buf
        }
        guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }

        let count = Int(out.frameLength)
        var sum: Float = 0
        for i in 0..<count {
            let v = Float(ch[0][i]) / 32768
            sum += v * v
        }
        let rms = sqrt(sum / Float(count))
        let db = 20 * log10(max(rms, 0.000_01))
        let level = min(1, max(0, (db + 55) / 45)) // -55dB静音 → 0，-10dB大声 → 1
        onLevel?(level)

        let bytes = Data(bytes: ch[0], count: count * 2)
        queue.async {
            self.buffer.append(bytes)
            while self.buffer.count >= self.chunkBytes {
                let chunk = self.buffer.prefix(self.chunkBytes)
                self.buffer.removeFirst(self.chunkBytes)
                self.onChunk?(Data(chunk))
            }
        }
    }
}
