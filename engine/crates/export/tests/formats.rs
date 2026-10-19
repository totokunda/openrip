//! The export dialog's options, each through the engine and read back with ffprobe: frame
//! rate conversion, a custom bit rate, audio-only files (WAV, FLAC, MP3, AAC) and GIFs.
#![cfg(target_os = "macos")]

use std::path::{Path, PathBuf};
use std::process::Command;

use openrip_export::{export, export_audio, export_gif, AudioFormat, Codec, ExportOptions, GifOptions};
use openrip_model::{FrameRate, Project};

fn tools() -> bool {
    Command::new("ffmpeg").arg("-version").output().is_ok() && Command::new("ffprobe").arg("-version").output().is_ok()
}

fn tmp(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name)
}

/// A moving, noisy 640x360 clip of 2 s with a 440 Hz tone, 30 fps.
fn source() -> PathBuf {
    static MADE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    MADE.get_or_init(make_source).clone()
}

fn make_source() -> PathBuf {
    let path = tmp("formats-source3.mp4");
    {
        let st = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2,noise=alls=12:allf=t,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=2", "-c:v", "libx264", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-b:v", "20M", "-c:a", "aac", "-shortest"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(st.success());
    }
    path
}

fn project(path: &Path) -> Project {
    let seg = |id: &str| {
        serde_json::json!({
            "id": id, "material": "m", "source": { "start": 0, "duration": 2000000 }, "target": { "start": 0, "duration": 2000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": 1.0, "y": 1.0 } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        })
    };
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "formats test", "canvas": { "width": 640, "height": 360 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [seg("s")] }],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path.to_str().unwrap(), "duration": 2000000, "has_audio": true }] }
    }))
    .expect("project json")
}

fn probe(path: &Path, entries: &str, select: &str) -> String {
    let out = Command::new("ffprobe").args(["-v", "error", "-count_frames", "-select_streams", select, "-show_entries", entries, "-of", "csv=p=0"]).arg(path).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn video(fps: FrameRate, bitrate: u64, exact: bool, audio: bool, w: u32, h: u32, name: &str) -> PathBuf {
    let out = tmp(name);
    export(project(&source()), &out, &ExportOptions { width: w, height: h, fps, codec: Codec::H264, bitrate, exact_bitrate: exact, audio }, |_, _| true).unwrap();
    out
}

#[test]
fn frame_rate_is_converted() {
    if !tools() {
        return;
    }
    for (fps, frames, rate) in [(FrameRate::new(24, 1), 48, "24/1"), (FrameRate::new(60, 1), 120, "60/1"), (FrameRate::new(30000, 1001), 60, "30000/1001")] {
        let out = video(fps, 4_000_000, false, false, 320, 180, &format!("formats-{}.mp4", fps.num));
        assert_eq!(probe(&out, "stream=r_frame_rate,nb_read_frames", "v:0"), format!("{rate},{frames}"), "{fps:?}");
    }
}

#[test]
fn resolution_and_audio_in_a_720p_mp4() {
    if !tools() {
        return;
    }
    let out = video(FrameRate::new(30, 1), 8_000_000, false, true, 1280, 720, "formats-720.mp4");
    assert_eq!(probe(&out, "stream=codec_name,width,height,r_frame_rate", "v:0"), "h264,1280,720,30/1");
    assert_eq!(probe(&out, "stream=codec_name,sample_rate,channels", "a:0"), "aac,44100,2");
}

#[test]
fn custom_bitrate_is_within_ten_percent() {
    if !tools() {
        return;
    }
    for kbps in [1_500u64, 3_000, 6_000] {
        let out = video(FrameRate::new(30, 1), kbps * 1000, true, false, 640, 360, &format!("formats-rate-{kbps}.mp4"));
        let size = std::fs::metadata(&out).unwrap().len() as f64;
        let actual = size * 8.0 / 2.0 / 1000.0;
        let off = (actual - kbps as f64).abs() / kbps as f64;
        eprintln!("{kbps}: {actual:.0} kbps"); assert!(off <= 0.10, "asked for {kbps} kbps, got {actual:.0} kbps ({:.1}% off)", off * 100.0);
    }
}

#[test]
fn audio_only_files() {
    if !tools() {
        return;
    }
    for (format, codec) in [(AudioFormat::Wav, "pcm_s16le"), (AudioFormat::Flac, "flac"), (AudioFormat::Mp3, "mp3"), (AudioFormat::Aac, "aac")] {
        let out = tmp(&format!("formats-audio.{}", format.extension()));
        let stats = export_audio(project(&source()), &out, format, |_, _| true).unwrap();
        assert_eq!(stats.frames, 0);
        assert_eq!(probe(&out, "stream=codec_name,sample_rate,channels", "a:0"), format!("{codec},44100,2"), "{format:?}");
        assert_eq!(probe(&out, "stream=codec_type", "v"), "", "{format:?} has no picture");
        let dur: f64 = probe(&out, "format=duration", "a:0").parse().unwrap();
        assert!((dur - 2.0).abs() < 0.1, "{format:?}: {dur} s");
        // The 440 Hz tone is in it, at about the level of the source (not silence).
        let vol = Command::new("ffmpeg").args(["-v", "info", "-i"]).arg(&out).args(["-af", "volumedetect", "-f", "null", "-"]).output().unwrap();
        let text = String::from_utf8_lossy(&vol.stderr).to_string();
        let mean: f64 = text.split("mean_volume: ").nth(1).and_then(|s| s.split(' ').next()).unwrap().parse().unwrap();
        assert!(mean > -30.0, "{format:?} mean {mean} dB");
    }
}

#[test]
fn audio_export_can_be_cancelled() {
    let out = tmp("formats-cancel.wav");
    let r = export_audio(project(&source()), &out, AudioFormat::Wav, |_, _| false);
    assert!(matches!(r, Err(openrip_export::ExportError::Cancelled)));
    assert!(!out.exists());
}

#[test]
fn gif_at_each_resolution() {
    if !tools() {
        return;
    }
    for short in [240u32, 320, 640] {
        let out = tmp(&format!("formats-{short}.gif"));
        let stats = export_gif(project(&source()), &out, &GifOptions { short_side: short, fps: 15.0 }, |_, _| true).unwrap();
        assert_eq!(stats.frames, 30);
        let w = (short as f64 * 640.0 / 360.0).round() as u32;
        assert_eq!(probe(&out, "stream=codec_name,width,height,nb_read_frames", "v:0"), format!("gif,{w},{short},30"));
        // Whole-second timing: the 30 frames last 2 s.
        let dur: f64 = probe(&out, "format=duration", "v:0").parse().unwrap();
        assert!((dur - 2.0).abs() < 0.05, "{dur}");
    }
}

#[test]
fn gif_frames_are_the_picture() {
    if !tools() {
        return;
    }
    // The GIF's first frame is the video's first frame, to a 256-colour palette's accuracy.
    let out = tmp("formats-pic.gif");
    export_gif(project(&source()), &out, &GifOptions { short_side: 240, fps: 15.0 }, |_, _| true).unwrap();
    let (g, s) = (tmp("formats-gif-frame.png"), tmp("formats-src-frame.png"));
    let png = |input: &Path, to: &Path, vf: &str| {
        assert!(Command::new("ffmpeg").args(["-v", "error", "-y", "-i"]).arg(input).args(["-frames:v", "1", "-vf", vf]).arg(to).status().unwrap().success());
    };
    png(&out, &g, "format=rgb24");
    png(&source(), &s, "scale=427:240");
    let r = Command::new("ffmpeg")
        .args(["-v", "info", "-i"])
        .arg(&g)
        .arg("-i")
        .arg(&s)
        .args(["-lavfi", "[0]scale=64:36:flags=area[a];[1]scale=64:36:flags=area[b];[a][b]psnr", "-f", "null", "-"])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&r.stderr).to_string();
    let psnr: f64 = text.split("average:").nth(1).and_then(|s| s.split_whitespace().next()).unwrap().parse().unwrap();
    assert!(psnr > 32.0, "PSNR {psnr} dB");
}

#[test]
fn gif_can_be_cancelled() {
    let out = tmp("formats-cancel.gif");
    let r = export_gif(project(&source()), &out, &GifOptions::default(), |n, _| n < 3);
    assert!(matches!(r, Err(openrip_export::ExportError::Cancelled)));
    assert!(!out.exists());
}
