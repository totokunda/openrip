//! Pre-rendering: chunks are rendered into the cache, shown in place of compositing, go stale
//! exactly where an edit touches them, and survive a restart.
#![cfg(target_os = "macos")]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use openrip_export::{prerender, prerender_available};
use openrip_model::{Micros, Project};
use openrip_playback::render_cache::{self, RenderCache};
use openrip_playback::PreviewEngine;

/// The tests share the process's cache (the engines read it), so they take turns.
static SERIAL: Mutex<()> = Mutex::new(());

fn tmp(name: &str) -> PathBuf {
    { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join(name)
}

fn have_tools() -> bool {
    Command::new("ffmpeg").arg("-version").output().is_ok()
}

/// A moving, noisy 640x360 clip of 6 s at 30 fps.
fn source() -> PathBuf {
    static MADE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    MADE.get_or_init(|| {
        let path = tmp("prerender-source.mp4");
        let st = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=6,noise=alls=12:allf=t,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-b:v", "20M", "-g", "30"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(st.success());
        path
    })
    .clone()
}

/// Two clips of the source, 0-3 s and 3-6 s, the second scaled by `scale_b`; the chunks are
/// 2 s, so chunk 0 holds only the first clip, 1 holds the cut, 2 only the second.
fn project(path: &Path, scale_b: f64) -> Project {
    let seg = |id: &str, at: i64, scale: f64| {
        serde_json::json!({
            "id": id, "material": "m", "source": { "start": at, "duration": 3000000 }, "target": { "start": at, "duration": 3000000 },
            "speed": 1.0, "visible": true, "render_index": 0,
            "transform": { "position": { "value": { "x": 0.0, "y": 0.0 } }, "scale": { "value": { "x": scale, "y": scale } }, "rotation": { "value": 0.0 } },
            "opacity": { "value": 1.0 }, "volume": { "value": 1.0 }
        })
    };
    serde_json::from_value(serde_json::json!({
        "format": 2, "id": "p", "name": "prerender test", "canvas": { "width": 640, "height": 360 }, "fps": { "num": 30, "den": 1 },
        "tracks": [{ "id": "t", "kind": "video", "segments": [seg("a", 0, 1.0), seg("b", 3000000, scale_b)] }],
        "materials": { "media": [{ "id": "m", "kind": "video", "path": path.to_str().unwrap(), "duration": 6000000, "has_audio": false }] }
    }))
    .expect("project json")
}

fn keys(cache: &RenderCache, p: &Project) -> Vec<Option<u64>> {
    cache.plan(p).chunks.iter().map(|c| c.key).collect()
}

#[test]
fn an_edit_changes_exactly_the_chunks_it_touches() {
    if !have_tools() {
        return;
    }
    let cache = RenderCache::new();
    let before = keys(&cache, &project(&source(), 1.0));
    assert_eq!(before.len(), 3);
    assert!(before.iter().all(Option::is_some));
    // Scaling the second clip: the first chunk (only the first clip) stays, the cut's and the
    // second clip's change.
    let after = keys(&cache, &project(&source(), 0.5));
    assert_eq!(before[0], after[0]);
    assert_ne!(before[1], after[1]);
    assert_ne!(before[2], after[2]);
    // The same project keys the same.
    assert_eq!(before, keys(&cache, &project(&source(), 1.0)));
    // A different frame rate or canvas changes every chunk.
    let mut other = project(&source(), 1.0);
    other.canvas.width = 1280;
    assert!(keys(&cache, &other).iter().zip(&before).all(|(a, b)| a != b));
    // Chunks beyond the clips have nothing to render.
    let mut short = project(&source(), 1.0);
    short.tracks[0].segments.truncate(1);
    assert_eq!(keys(&cache, &short).iter().map(Option::is_some).collect::<Vec<_>>(), [true, true]);
    // Sizes: the canvas's aspect, even, at most 1920 on the long side.
    assert_eq!(render_cache::render_size(3840, 2160), (1920, 1080));
    assert_eq!(render_cache::render_size(1080, 1920), (1080, 1920));
    assert_eq!(render_cache::render_size(641, 361), (640, 360));
}

/// The mean signed difference of the colour channels (a colour or brightness shift, not noise).
fn bias(a: &[u8], b: &[u8]) -> f64 {
    let sum: i64 = a.chunks_exact(4).zip(b.chunks_exact(4)).map(|(x, y)| (0..3).map(|c| x[c] as i64 - y[c] as i64).sum::<i64>()).sum();
    sum as f64 / (a.len() / 4 * 3) as f64
}

fn mean_diff(a: &[u8], b: &[u8]) -> f64 {
    let mut sum = 0u64;
    let mut n = 0u64;
    for (x, y) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        for c in 0..3 {
            sum += (x[c] as i64 - y[c] as i64).unsigned_abs();
            n += 1;
        }
    }
    sum as f64 / n as f64
}

#[test]
fn rendered_chunks_match_the_composited_frames_and_survive_a_restart() {
    if !have_tools() || !prerender_available() {
        return;
    }
    let _turn = SERIAL.lock().unwrap();
    let dir = tmp("prerender-cache");
    let _ = std::fs::remove_dir_all(&dir);
    let cache = RenderCache::global();
    cache.set_dir(&dir);
    cache.clear();
    cache.set_enabled(true);
    let p = project(&source(), 0.5);
    assert!(cache.rendered_ranges(&p).is_empty());

    // Render the first two chunks (0-4 s) with progress, then the rest.
    let mut last = (0, 0);
    let stats = prerender(p.clone(), cache, Some((Micros(0), Micros(3_500_000))), |d, t| {
        last = (d, t);
        true
    })
    .unwrap();
    assert_eq!((stats.rendered, stats.reused), (2, 0));
    assert_eq!(last, (120, 120));
    assert_eq!(cache.rendered_ranges(&p), vec![(Micros(0), Micros(4_000_000))]);
    assert!(cache.bytes() > 0);

    // Its frames are the composited ones, within the intermediate's compression.
    let mut engine = PreviewEngine::new(p.clone()).unwrap();
    for t in [0, 1_033_333, 2_500_000, 3_966_666] {
        let (cached, _, from_cache) = engine.render_image_cached(Micros(t), 640, 360).unwrap();
        assert!(from_cache, "frame at {t} comes from a chunk");
        let (composited, _) = engine.render_image(Micros(t), 640, 360).unwrap();
        let d = mean_diff(&cached.data, &composited.data);
        let b = bias(&cached.data, &composited.data);
        eprintln!("frame at {t}: mean difference {d:.2}, bias {b:.2} (of 255)");
        // The test picture is dense noise on a colour chart: the intermediate's loss shows
        // as small noise, never as a shift of colour or brightness.
        assert!(d < 5.0 && b.abs() < 0.8, "frame at {t}: mean difference {d:.2}, bias {b:.2} / 255");
    }
    // Beyond what is rendered, it composites.
    let (_, _, from_cache) = engine.render_image_cached(Micros(4_500_000), 640, 360).unwrap();
    assert!(!from_cache);

    // An edit of the second clip leaves the first chunk rendered and the second stale.
    let edited = project(&source(), 0.6);
    assert_eq!(cache.rendered_ranges(&edited), vec![(Micros(0), Micros(2_000_000))]);

    // Rendering the edited project does only what changed.
    let stats = prerender(edited.clone(), cache, None, |_, _| true).unwrap();
    assert_eq!((stats.rendered, stats.reused), (2, 1));
    assert_eq!(cache.rendered_ranges(&edited), vec![(Micros(0), Micros(6_000_000))]);

    // A restart: the index is read again from the folder, and the chunks are still there.
    cache.set_dir(&dir);
    assert_eq!(cache.rendered_ranges(&edited), vec![(Micros(0), Micros(6_000_000))]);
    let mut engine = PreviewEngine::new(edited.clone()).unwrap();
    assert!(engine.render_image_cached(Micros(5_000_000), 640, 360).unwrap().2);

    // Export-style rendering never reads the chunks (render_image composites).
    let hits = cache.stats().hits;
    engine.render_image(Micros(1_000_000), 640, 360).unwrap();
    assert_eq!(cache.stats().hits, hits);

    // Deleting the cache empties it, and an engine that had a chunk open drops it.
    cache.clear();
    assert!(cache.rendered_ranges(&edited).is_empty());
    assert_eq!(cache.bytes(), 0);
    assert!(!engine.render_image_cached(Micros(5_000_000), 640, 360).unwrap().2);
}

#[test]
fn cancelling_keeps_the_finished_chunks_only() {
    if !have_tools() || !prerender_available() {
        return;
    }
    let _turn = SERIAL.lock().unwrap();
    let dir = tmp("prerender-cancel");
    let _ = std::fs::remove_dir_all(&dir);
    let cache = RenderCache::global();
    cache.set_dir(&dir);
    cache.clear();
    let p = project(&source(), 0.5);
    // Stop in the middle of the second chunk.
    let r = prerender(p.clone(), cache, None, |done, _| done < 90);
    assert!(matches!(r, Err(openrip_export::ExportError::Cancelled)));
    assert_eq!(cache.rendered_ranges(&p), vec![(Micros(0), Micros(2_000_000))]);
    let leftovers: Vec<_> = std::fs::read_dir(dir.join("prerender")).unwrap().flatten().filter(|f| f.file_name().to_string_lossy().contains(".part")).collect();
    assert!(leftovers.is_empty(), "no unfinished file stays");
    cache.clear();
}
