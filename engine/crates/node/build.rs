fn main() {
    napi_build::setup();
    if std::env::var_os("CARGO_FEATURE_STATIC_FFMPEG").is_some() {
        let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        if os == "windows" {
            // Windows has no zlib: build-ffmpeg.sh builds zlib.lib beside FFmpeg's libraries.
            // And the system libraries FFmpeg's Windows code calls: CNG for random numbers,
            // COM, and the GUIDs of Media Foundation's and DirectShow's headers.
            println!("cargo:rustc-link-lib=static=zlib");
            for lib in ["bcrypt", "ole32", "user32", "mfuuid", "strmiids"] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        } else {
            // Static FFmpeg needs the zlib it was configured with (macOS and Linux ship it).
            println!("cargo:rustc-link-lib=z");
        }
        // ...and compiler-rt for its `__builtin_available` checks. The addon links with
        // `-undefined dynamic_lookup` (napi), so without it the call fails only when made.
        if os == "macos" {
            let out = std::process::Command::new("clang").arg("--print-resource-dir").output().expect("clang");
            let dir = String::from_utf8(out.stdout).unwrap();
            println!("cargo:rustc-link-search=native={}/lib/darwin", dir.trim());
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
            // FFmpeg's AVFoundation pulls in the Swift CoreMedia overlay on x86_64, which
            // macOS keeps in /usr/lib/swift.
            println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        }
    }
}
