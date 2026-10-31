import AVFoundation
import SwiftUI
import UIKit

/// Kamera oturumu. Yapilandirma ve calistirma ana is parcacigini
/// bloklamamak icin kendi kuyrugunda yurutuluyor.
final class CameraController: NSObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()

    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "tryit.camera")
    private var completion: ((Data?) -> Void)?
    private var position: AVCaptureDevice.Position = .back

    /// Simulatorde kamera yok; arayuz buna gore aciklama gosteriyor.
    static var isAvailable: Bool {
        AVCaptureDevice.default(for: .video) != nil
    }

    func configure() {
        queue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .photo
            self.attachInput()
            if self.session.canAddOutput(self.output) {
                self.session.addOutput(self.output)
            }
            self.session.commitConfiguration()
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    func flip() {
        queue.async { [weak self] in
            guard let self else { return }
            self.position = self.position == .back ? .front : .back
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            self.attachInput()
            self.session.commitConfiguration()
        }
    }

    /// Yalnizca kuyrukta cagriliyor.
    private func attachInput() {
        guard let device = AVCaptureDevice.default(
            .builtInWideAngleCamera, for: .video, position: position
        ) ?? AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)
    }

    func capture(_ completion: @escaping (Data?) -> Void) {
        self.completion = completion
        output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        let data = photo.fileDataRepresentation()
        DispatchQueue.main.async { [weak self] in
            self?.completion?(data)
            self?.completion = nil
        }
    }
}

/// Canli kamera goruntusu.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Siluet hizalamali cekim ekrani.
struct CameraCaptureView: View {
    let onCaptured: (Data) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var controller = CameraController()
    @State private var permission: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if permission == .authorized && CameraController.isAvailable {
                CameraPreview(session: controller.session).ignoresSafeArea()
                SilhouetteGuide()
            } else {
                unavailable
            }

            controls
        }
        .task {
            if permission == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                permission = granted ? .authorized : .denied
            }
            if permission == .authorized { controller.configure() }
        }
        .onDisappear { controller.stop() }
    }

    private var unavailable: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera")
                .font(.system(size: 26, weight: .ultraLight))
                .foregroundStyle(Palette.white)
            Text(permission == .denied ? "Kamera izni kapalı" : "Bu cihazda kamera yok")
                .font(Typo.headlineSm(17))
                .foregroundStyle(Palette.white)
            Text(permission == .denied
                 ? "Ayarlar'dan kamera iznini açabilirsin."
                 : "Simülatörde kamera çalışmıyor, galeriden seç.")
                .font(Typo.bodyMd)
                .foregroundStyle(Palette.white.opacity(0.65))
                .multilineTextAlignment(.center)
        }
        .padding(30)
    }

    private var controls: some View {
        VStack {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Palette.white)
                        .padding(11)
                        .background(.black.opacity(0.4))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Spacer()

                if CameraController.isAvailable {
                    Button { controller.flip() } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Palette.white)
                            .padding(11)
                            .background(.black.opacity(0.4))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, SafeArea.top + 6)

            Spacer()

            if permission == .authorized && CameraController.isAvailable {
                Button {
                    controller.capture { data in
                        guard let data else { return }
                        onCaptured(data)
                        dismiss()
                    }
                } label: {
                    Circle()
                        .fill(Palette.white)
                        .frame(width: 70, height: 70)
                        .overlay(Circle().strokeBorder(.black.opacity(0.15), lineWidth: 2).padding(5))
                }
                .buttonStyle(.plain)
                .padding(.bottom, SafeArea.bottom + 24)
            }
        }
    }
}
