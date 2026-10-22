//! H.264 in software through Cisco's OpenH264 binary, downloaded from Cisco as the app does:
//! a wrong download is refused, the right one is installed and loaded, and a 1 s export comes
//! out as H.264 High, BT.709 limited range, with every frame and the right colour.
//!
//! It downloads (about 0.5 MB) with `curl`, so it doesn't run by default:
//!   cargo test -p openrip-export --test openh264 -- --ignored

use std::path::PathBuf;
use std::process::Command;

use openrip_export::{export, openh264, Backend, Codec, ExportOptions};
use openrip_model::{FrameRate, Project};

fn tmp(name: &str) -> PathBuf {
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("openh264");
    std::fs::create_dir_all(&d).unwrap();
    d.join(name)
}

#[test]
#[ignore = "downloads Cisco's OpenH264 binary"]
fn downloads_installs_and_exports_h264_in_software() {
    let pin = openh264::pin().expect("Cisco makes a binary for this platform");
    let bz2 = tmp(&format!("{}.bz2", pin.file));
    let st = Command::new("curl").args(["-fsSL", "--retry", "2", "-o"]).arg(&bz2).arg(pin.url()).status().unwrap();
    assert!(st.success(), "download failed");
    let bytes = std::fs::read(&bz2).unwrap();
    let dir = tmp("codecs");
    let _ = std::fs::remove_file(dir.join(pin.file));
    openh264::set_codec_dir(&dir);
    assert!(!openh264::status().installed);
    // A damaged download is refused and nothing is kept.
    let mut damaged = bytes.clone();
    let mid = damaged.len() / 2;
    damaged[mid] ^= 1;
    assert!(openh264::install(&damaged).unwrap_err().to_string().contains("SHA-256"));
    assert!(!dir.join(pin.file).exists());
    // Cisco's is installed and loads.
    openh264::install(&bytes).unwrap();
    let s = openh264::status();
    assert!(s.installed && s.error.is_none(), "{s:?}");

    let png = tmp("still.png");
    let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xC03020:s=320x180", "-frames:v", "1"]).arg(&png).status().unwrap();
    assert!(st.success());
    let project: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "openh264",
        "canvas": { "width": 320, "height": 180 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": 1000000 }, "target": { "start": 0, "duration": 1000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "photo", "path": png.to_str().unwrap(), "duration": 1000000 }] }
    }))
    .unwrap();
    let out = tmp("h264.mp4");
    let o = ExportOptions { width: 320, height: 180, fps: FrameRate::new(30, 1), codec: Codec::H264, bitrate: 2_000_000, exact_bitrate: false, audio: false, hardware: false };
    let stats = export(project, &out, &o, |_, _| true).unwrap();
    assert_eq!(stats.backend, Some(Backend::OpenH264));
    let probe = Command::new("ffprobe")
        .args(["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,profile,pix_fmt,width,height,nb_read_frames,color_range,color_space,color_primaries,color_transfer", "-of", "csv=p=0"])
        .arg(&out)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "h264,High,320,180,yuv420p,tv,bt709,bt709,bt709,30");
    let px = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(&out)
        .args(["-frames:v", "1", "-vf", "crop=2:2:159:89,scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24", "-f", "rawvideo", "-"])
        .output()
        .unwrap()
        .stdout;
    let (r, g, b) = (px[0] as i32, px[1] as i32, px[2] as i32);
    assert!((r - 0xC0).abs() <= 3 && (g - 0x30).abs() <= 3 && (b - 0x20).abs() <= 3, "{r} {g} {b}");
}
