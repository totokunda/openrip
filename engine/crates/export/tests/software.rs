//! Exports with hardware encoding off, read back with ffprobe/ffmpeg: ProRes through FFmpeg's
//! `prores_ks` (422, and 4444 with alpha), and H.264 asking for OpenH264 when it isn't there
//! (or isn't Cisco's) while everything else goes on working. The H.264 export itself, with
//! Cisco's binary downloaded, is in tests/openh264.rs.

use std::path::{Path, PathBuf};
use std::process::Command;

use openrip_export::{export, openh264, Backend, Codec, ExportError, ExportOptions, ProRes};
use openrip_model::{FrameRate, Project};

fn tools() -> bool {
    Command::new("ffmpeg").arg("-version").output().is_ok() && Command::new("ffprobe").arg("-version").output().is_ok()
}

fn tmp(name: &str) -> PathBuf {
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("software");
    std::fs::create_dir_all(&d).unwrap();
    d.join(name)
}

/// A 320x180 picture of one colour.
fn still() -> PathBuf {
    static MADE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    MADE.get_or_init(|| {
        let png = tmp("still.png");
        let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xC03020:s=320x180", "-frames:v", "1"]).arg(&png).status().unwrap();
        assert!(st.success());
        png
    })
    .clone()
}

/// One second of the still at 30 fps, scaled by `scale` on a 320x180 canvas.
fn project(scale: f64) -> Project {
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "software export",
        "canvas": { "width": 320, "height": 180 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": 1000000 }, "target": { "start": 0, "duration": 1000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": scale, "y": scale } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "photo", "path": still().to_str().unwrap(), "duration": 1000000 }] }
    }))
    .expect("project json")
}

fn options(codec: Codec) -> ExportOptions {
    ExportOptions { width: 320, height: 180, fps: FrameRate::new(30, 1), codec, bitrate: 2_000_000, exact_bitrate: false, audio: false, hardware: false }
}

fn probe(path: &Path) -> String {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name,profile,pix_fmt,width,height,nb_frames,color_range,color_space", "-of", "csv=p=0"])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// The first frame's RGBA at (x, y), decoded as BT.709 limited range.
fn pixel(path: &Path, x: u32, y: u32) -> [i32; 4] {
    let px = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-vf", &format!("crop=2:2:{x}:{y},scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgba"), "-f", "rawvideo", "-"])
        .output()
        .unwrap()
        .stdout;
    [px[0] as i32, px[1] as i32, px[2] as i32, px[3] as i32]
}

fn near(px: [i32; 4], rgb: [i32; 3]) -> bool {
    (0..3).all(|i| (px[i] - rgb[i]).abs() <= 3)
}

#[test]
fn prores_422_in_software() {
    if !tools() {
        return;
    }
    let out = tmp("prores-422.mov");
    let stats = export(project(1.0), &out, &options(Codec::ProRes(ProRes::Standard)), |_, _| true).unwrap();
    assert_eq!(stats.backend, Some(Backend::ProResKs));
    assert_eq!(probe(&out), "prores,Standard,320,180,yuv422p10le,tv,bt709,30");
    let px = pixel(&out, 160, 90);
    assert!(near(px, [0xC0, 0x30, 0x20]), "{px:?}");
}

#[test]
fn prores_4444_in_software_keeps_alpha() {
    if !tools() {
        return;
    }
    let out = tmp("prores-4444.mov");
    // Half size: the canvas around it is transparent.
    let stats = export(project(0.5), &out, &options(Codec::ProRes(ProRes::FourFourFourFour)), |_, _| true).unwrap();
    assert_eq!(stats.backend, Some(Backend::ProResKs));
    assert_eq!(probe(&out), "prores,4444,320,180,yuva444p12le,tv,bt709,30");
    let (inside, outside) = (pixel(&out, 160, 90), pixel(&out, 5, 5));
    assert!(near(inside, [0xC0, 0x30, 0x20]) && inside[3] == 255, "{inside:?}");
    assert_eq!(outside[3], 0, "{outside:?}");
}

#[test]
fn h264_in_software_asks_for_openh264_and_the_rest_goes_on() {
    if !tools() {
        return;
    }
    let Some(pin) = openh264::pin() else { return };
    let out = tmp("h264.mp4");
    // Not downloaded: nothing is written, and the app is asked to fetch it.
    let empty = tmp("codecs-empty");
    std::fs::create_dir_all(&empty).unwrap();
    openh264::set_codec_dir(&empty);
    let r = export(project(1.0), &out, &options(Codec::H264), |_, _| true);
    assert!(matches!(r, Err(ExportError::NeedsOpenH264)), "{r:?}");
    assert!(!out.exists());
    let listed = openrip_export::encoders();
    assert!(listed.iter().any(|e| e.backend == Backend::OpenH264 && e.needs_download));
    // A file that isn't Cisco's binary is never loaded.
    let wrong = tmp("codecs-wrong");
    std::fs::create_dir_all(&wrong).unwrap();
    std::fs::write(wrong.join(pin.file), b"not OpenH264").unwrap();
    openh264::set_codec_dir(&wrong);
    let r = export(project(1.0), &out, &options(Codec::H264), |_, _| true);
    assert!(matches!(r, Err(ExportError::NeedsOpenH264)), "{r:?}");
    let s = openh264::status();
    assert!(!s.installed && s.error.as_deref().is_some_and(|e| e.contains("SHA-256")), "{s:?}");
    // Turned off, it isn't offered at all.
    openh264::set_enabled(false);
    assert!(!openrip_export::encoders().iter().any(|e| e.backend == Backend::OpenH264));
    openh264::set_enabled(true);
    // ProRes in software still exports.
    let pr = tmp("after.mov");
    export(project(1.0), &pr, &options(Codec::ProRes(ProRes::Lt)), |_, _| true).unwrap();
    assert!(probe(&pr).starts_with("prores,LT,"));
}

#[test]
fn hevc_has_no_software_encoder_but_windows_own() {
    if !tools() || cfg!(windows) {
        return;
    }
    let e = export(project(1.0), &tmp("hevc.mp4"), &options(Codec::Hevc), |_, _| true).err().unwrap().to_string();
    assert!(e.contains("no encoder on this machine writes hevc in software"), "{e}");
}
