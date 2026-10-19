// Read a video with AVFoundation as BGRA and print `frames <n> alpha <min> <max>` for its tenth
// frame: whether the system decodes it, and whether it carries transparency (the Export steps).
//   swiftc -O alpha.swift -o alpha && ./alpha file.mov
import AVFoundation
import CoreVideo

let asset = AVAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let done = DispatchSemaphore(value: 0)
Task {
    var n = 0
    var lo = 255
    var hi = 0
    do {
        let track = try await asset.loadTracks(withMediaType: .video)[0]
        let reader = try AVAssetReader(asset: asset)
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        reader.add(out)
        reader.startReading()
        while let s = out.copyNextSampleBuffer() {
            n += 1
            if n < 10 { continue }
            let pb = CMSampleBufferGetImageBuffer(s)!
            CVPixelBufferLockBaseAddress(pb, .readOnly)
            let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
            let base = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: UInt8.self)
            for y in 0..<h { for x in 0..<w { let a = Int(base[y * bpr + x * 4 + 3]); lo = min(lo, a); hi = max(hi, a) } }
            break
        }
    } catch {}
    print("frames \(n) alpha \(lo) \(hi)")
    done.signal()
}
done.wait()
