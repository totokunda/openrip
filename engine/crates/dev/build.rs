fn main() {
    if std::env::var_os("CARGO_FEATURE_STATIC_FFMPEG").is_some() {
        // Static FFmpeg needs the zlib it was configured with (macOS ships it), and
        // compiler-rt for its `__builtin_available` checks (rustc links without it).
        println!("cargo:rustc-link-lib=z");
        let out = std::process::Command::new("clang").arg("--print-resource-dir").output().expect("clang");
        let dir = String::from_utf8(out.stdout).unwrap();
        println!("cargo:rustc-link-search=native={}/lib/darwin", dir.trim());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
        // FFmpeg's AVFoundation pulls in the Swift CoreMedia overlay on x86_64.
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
