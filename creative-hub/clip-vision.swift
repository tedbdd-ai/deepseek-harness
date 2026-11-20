import Foundation
import ImageIO
import Vision

struct Recognition: Codable {
    struct Label: Codable {
        let name: String
        let confidence: Float
    }
    let labels: [Label]
    struct Swatch: Codable {
        let hex: String
        let share: Float
    }
    let version: Int
    let face: Float
    let person: Float
    /// Up to five dominant colours, largest share first.
    let colors: [Swatch]
    /// Base64 of the Vision feature print as float32 values.
    let featureprint: String?
    /// Text found in screenshots and documents; empty for photos.
    let text: String
}

let analysisVersion = 1

/// Histogram of a 32 px thumbnail in 4 bits per channel; the bucket mean is the swatch colour.
func dominantColors(_ image: CGImage) -> [Recognition.Swatch] {
    let size = 32
    var pixels = [UInt8](repeating: 0, count: size * size * 4)
    guard let context = CGContext(data: &pixels, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [] }
    context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    var buckets: [Int: (count: Int, r: Int, g: Int, b: Int)] = [:]
    for index in 0..<(size * size) {
        let r = Int(pixels[index * 4]), g = Int(pixels[index * 4 + 1]), b = Int(pixels[index * 4 + 2])
        let key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)
        let old = buckets[key] ?? (0, 0, 0, 0)
        buckets[key] = (old.count + 1, old.r + r, old.g + g, old.b + b)
    }
    return buckets.values.sorted { $0.count > $1.count }.prefix(5).map {
        Recognition.Swatch(hex: String(format: "#%02x%02x%02x", $0.r / $0.count, $0.g / $0.count, $0.b / $0.count),
            share: Float($0.count) / Float(size * size))
    }
}

func recognize(_ data: Data) throws -> Recognition? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: 1024,
          ] as CFDictionary) else { return nil }
    let classification = VNClassifyImageRequest()
    let faces = VNDetectFaceRectanglesRequest()
    let people = VNDetectHumanRectanglesRequest()
    people.upperBodyOnly = true
    let prints = VNGenerateImageFeaturePrintRequest()
    let handler = VNImageRequestHandler(cgImage: image)
    try handler.perform([classification, faces, people, prints])
    let labels = classification.results ?? []
    var text = ""
    if labels.contains(where: { ($0.identifier.contains("screenshot") || $0.identifier.contains("document")) && $0.confidence >= 0.25 }) {
        let recognizer = VNRecognizeTextRequest()
        recognizer.recognitionLevel = .fast
        try? handler.perform([recognizer])
        text = String((recognizer.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").prefix(4000))
    }
    return Recognition(
        labels: labels.prefix(120).map { Recognition.Label(name: $0.identifier, confidence: $0.confidence) },
        version: analysisVersion,
        face: faces.results?.filter { $0.boundingBox.width * $0.boundingBox.height >= 0.003 }.map(\.confidence).max() ?? 0,
        person: people.results?.filter { $0.boundingBox.width * $0.boundingBox.height >= 0.01 }.map(\.confidence).max() ?? 0,
        colors: dominantColors(image),
        featureprint: prints.results?.first.map { $0.data.base64EncodedString() },
        text: text
    )
}

let encoder = JSONEncoder()
while let line = readLine() {
    do {
        if let data = Data(base64Encoded: line), let result = try recognize(data) {
            FileHandle.standardOutput.write(try encoder.encode(result))
            FileHandle.standardOutput.write(Data([10]))
            continue
        }
    } catch {
        // If Vision cannot decode one clip, keep the worker available for the next one.
    }
    FileHandle.standardOutput.write(Data("null\n".utf8))
}
