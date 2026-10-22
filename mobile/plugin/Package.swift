// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "UiableSsh",
    platforms: [.iOS(.v17)],
    products: [.library(name: "UiableSsh", targets: ["UiableSshPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.0.0"),
        // Pure-Swift SSH (SwiftNIO SSH): password + ed25519/rsa keys, exec, PTY, SFTP, direct-tcpip
        .package(url: "https://github.com/orlandos-nl/Citadel.git", from: "0.12.0"),
    ],
    targets: [
        .target(name: "UiableSshPlugin",
                dependencies: [
                    .product(name: "Capacitor", package: "capacitor-swift-pm"),
                    .product(name: "Cordova", package: "capacitor-swift-pm"),
                    .product(name: "Citadel", package: "Citadel"),
                ],
                path: "ios/Sources/UiableSshPlugin"),
    ]
)
