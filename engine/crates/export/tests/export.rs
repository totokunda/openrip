//! Export a tiny generated project and check the file: frame count, colour tags, pixels.
#![cfg(target_os = "macos")]

use std::path::PathBuf;
use std::process::Command;

use openrip_export::{export, Codec, ExportOptions};
use openrip_model::{FrameRate, Project};

fn ffmpeg_ok() -> bool {
    Command::new("ffmpeg").arg("-version").output().is_ok()
}

#[test]
fn exports_a_still_as_h264_bt709() {
    if !ffmpeg_ok() {
        return;
    }
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let png = dir.join("export-still.png");
    let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xC03020:s=320x180", "-frames:v", "1"]).arg(&png).status().unwrap();
    assert!(st.success());
    let project: Project = serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "export test",
        "canvas": { "width": 320, "height": 180 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [{
            "id": "s", "material": "m", "source": { "start": 0, "duration": 1000000 }, "target": { "start": 0, "duration": 1000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        }]}],
        "materials": { "media": [{ "id": "m", "kind": "photo", "path": png.to_str().unwrap(), "duration": 1000000 }] }
    }))
    .expect("project json");
    let out = dir.join("export-still.mp4");
    let stats = export(project, &out, &ExportOptions { width: 320, height: 180, fps: FrameRate::new(30, 1), codec: Codec::H264, bitrate: 2_000_000, exact_bitrate: false, audio: false }, |_, _| true).unwrap();
    assert_eq!(stats.frames, 30);
    let probe = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "stream=codec_name,width,height,nb_frames,color_range,color_space", "-of", "csv=p=0"])
        .arg(&out)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "h264,320,180,tv,bt709,30");
    // Centre pixel, decoded as BT.709 limited range, is the source colour.
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
