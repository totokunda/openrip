//! Audio parity tools: our mix against CapCut's export, our loudness meter against the
//! loudness CapCut measured for its drafts, and our beat detection against CapCut's beats
//! (docs/parity/loudness.md, docs/parity/beats.md, docs/parity/voice-effects.md). Drafts are
//! numbered, never named.

use std::path::{Path, PathBuf};

use openrip_audio::{open_audio, Mixer, CHANNELS, RATE};
use openrip_model::{Micros, Project};
use realfft::RealFftPlanner;
use serde_json::Value;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// `n` samples of a project's mix from sample `first` (48 kHz stereo), in blocks of 4096 as
/// `mix` writes them.
pub fn mix(project: Project, first: i64, n: usize) -> Result<Vec<f32>> {
    let mut mixer = Mixer::new(project);
    let mut pcm = Vec::with_capacity(n * CHANNELS);
    let mut block = vec![0f32; 4096 * CHANNELS];
    while pcm.len() < n * CHANNELS {
        let k = (n - pcm.len() / CHANNELS).min(4096);
        mixer.mix(first + (pcm.len() / CHANNELS) as i64, &mut block[..k * CHANNELS])?;
        pcm.extend_from_slice(&block[..k * CHANNELS]);
    }
    Ok(pcm)
}

/// `n` samples of a file's sound from sample `first` (48 kHz stereo).
fn decode(path: &Path, first: i64, n: usize) -> Result<Vec<f32>> {
    let mut d = open_audio(path, RATE)?.ok_or("no audio in the export")?;
    let mut pcm = vec![0f32; n * CHANNELS];
    d.read(first, &mut pcm)?;
    Ok(pcm)
}

fn mono(x: &[f32]) -> Vec<f32> {
    x.chunks_exact(CHANNELS).map(|f| 0.5 * (f[0] + f[1])).collect()
}

fn rms(x: &[f32]) -> f64 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt()
}

fn correlation(a: &[f32], b: &[f32]) -> f64 {
    let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        ab += (*x as f64) * (*y as f64);
        aa += (*x as f64).powi(2);
        bb += (*y as f64).powi(2);
    }
    if aa * bb > 0.0 {
        ab / (aa * bb).sqrt()
    } else {
        0.0
    }
}

/// The lag (samples, positive when `b` is late) within ±`max` that best lines `b` up with
/// `a`, by cross-correlation.
fn best_lag(a: &[f32], b: &[f32], max: usize) -> i64 {
    let n = a.len().min(b.len()).min(RATE as usize * 20);
    let size = (n + max).next_power_of_two() * 2;
    let mut planner = RealFftPlanner::<f64>::new();
    let (fft, ifft) = (planner.plan_fft_forward(size), planner.plan_fft_inverse(size));
    let pad = |x: &[f32]| -> Vec<f64> {
        let mut v: Vec<f64> = x[..n].iter().map(|v| *v as f64).collect();
        v.resize(size, 0.0);
        v
    };
    let (mut fa, mut fb) = (fft.make_output_vec(), fft.make_output_vec());
    let _ = fft.process(&mut pad(a), &mut fa);
    let _ = fft.process(&mut pad(b), &mut fb);
    let mut prod: Vec<_> = fa.iter().zip(&fb).map(|(x, y)| x.conj() * y).collect();
    let mut out = vec![0f64; size];
    let _ = ifft.process(&mut prod, &mut out);
    let at = |lag: i64| out[lag.rem_euclid(size as i64) as usize];
    (-(max as i64)..=max as i64).max_by(|&x, &y| at(x).total_cmp(&at(y))).unwrap_or(0)
}

/// Per-frame band levels (20 log bands, 150–8000 Hz) of mono `x`, dB; 2048-sample frames
/// every 1024.
fn band_levels(x: &[f32]) -> Vec<[f64; 20]> {
    const N: usize = 2048;
    let fft = RealFftPlanner::<f64>::new().plan_fft_forward(N);
    let window: Vec<f64> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / N as f64).cos()).collect();
    let edges: Vec<usize> = (0..=20).map(|b| (150.0 * (8000.0f64 / 150.0).powf(b as f64 / 20.0) * N as f64 / RATE as f64).round() as usize).collect();
    let mut spec = fft.make_output_vec();
    let mut out = Vec::new();
    let mut t = 0;
    while t + N <= x.len() {
        let mut buf: Vec<f64> = x[t..t + N].iter().zip(&window).map(|(v, w)| *v as f64 * w).collect();
        let _ = fft.process(&mut buf, &mut spec);
        let mut bands = [0f64; 20];
        for b in 0..20 {
            let e: f64 = spec[edges[b]..edges[b + 1].max(edges[b] + 1)].iter().map(|z| z.norm_sqr()).sum();
            bands[b] = 10.0 * (e + 1e-12).log10();
        }
        out.push(bands);
        t += N / 2;
    }
    out
}

/// The per-frame, per-band level difference with the overall level difference removed (dB),
/// over frames where both are audible: how differently the two sound, not how loud.
fn distance(a: &[f32], b: &[f32]) -> Option<f64> {
    let (la, lb) = (band_levels(a), band_levels(b));
    let pairs: Vec<(&[f64; 20], &[f64; 20])> = la.iter().zip(&lb).filter(|(x, y)| x.iter().sum::<f64>() / 20.0 > -60.0 && y.iter().sum::<f64>() / 20.0 > -60.0).collect();
    if pairs.is_empty() {
        return None;
    }
    let overall = pairs.iter().map(|(x, y)| x.iter().zip(y.iter()).map(|(p, q)| p - q).sum::<f64>() / 20.0).sum::<f64>() / pairs.len() as f64;
    Some(pairs.iter().map(|(x, y)| (x.iter().zip(y.iter()).map(|(p, q)| (p - q - overall).powi(2)).sum::<f64>() / 20.0).sqrt()).sum::<f64>() / pairs.len() as f64)
}

/// `audio-parity <draft> <export> [--from S] [--to S] [--window S] [--all]`
pub fn parity(args: &[String], project: Project) -> Result<()> {
    let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(|s| s.parse::<f64>()).transpose();
    let from = opt("--from")?.unwrap_or(0.0);
    let to = opt("--to")?.unwrap_or(project.duration().as_secs_f64());
    let window = opt("--window")?.unwrap_or(1.0);
    let all = args.iter().any(|a| a == "--all");
    let first = (from * RATE as f64).round() as i64;
    let n = ((to - from) * RATE as f64).round().max(0.0) as usize;
    let ours = mix(project, first, n)?;
    let theirs = decode(Path::new(&args[2]), first, n)?;
    let (mo, mt) = (mono(&ours), mono(&theirs));
    let lag = best_lag(&mo, &mt, 4800);
    // Line theirs up with ours.
    let shift = |x: &[f32], lag: i64| -> Vec<f32> { (0..x.len() as i64).map(|i| x.get((i + lag) as usize).copied().unwrap_or(0.0)).collect() };
    let mt = shift(&mt, lag);
    let level = |a: &[f32], b: &[f32]| 20.0 * (rms(a) / rms(b).max(1e-12)).log10();
    println!("{:.2}–{:.2} s: lag {lag} samples ({:.2} ms), correlation {:.4}, level {:+.2} dB (ours vs CapCut's), distance {}", from, to, lag as f64 * 1e3 / RATE as f64, correlation(&mo, &mt), level(&mo, &mt), distance(&mo, &mt).map_or("-".into(), |d| format!("{d:.2} dB")));
    let w = (window * RATE as f64) as usize;
    let mut rows = Vec::new();
    for (k, (a, b)) in mo.chunks(w).zip(mt.chunks(w)).enumerate() {
        if rms(b) < 1e-4 && rms(a) < 1e-4 {
            continue;
        }
        rows.push((from + k as f64 * window, correlation(a, b), level(a, b), distance(a, b)));
    }
    if !all {
        rows.sort_by(|x, y| x.1.total_cmp(&y.1));
        rows.truncate(5);
        println!("lowest correlation:");
    }
    for (t, c, l, d) in rows {
        println!("  {t:7.2} s  correlation {c:.4}  level {l:+6.2} dB  distance {}", d.map_or("-".into(), |d| format!("{d:.2} dB")));
    }
    Ok(())
}

fn drafts(root: &Path) -> Result<Vec<PathBuf>> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)?.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.join("draft_info.json").exists()).collect();
    dirs.sort();
    Ok(dirs)
}

fn by_id<'a>(mats: &'a Value) -> std::collections::HashMap<&'a str, (&'a str, &'a Value)> {
    let mut out = std::collections::HashMap::new();
    for (table, items) in mats.as_object().into_iter().flatten() {
        for m in items.as_array().into_iter().flatten() {
            if let Some(id) = m.get("id").and_then(Value::as_str) {
                out.insert(id, (table.as_str(), m));
            }
        }
    }
    out
}

/// `loudness-scan <projects-root>`: for every loudness material CapCut measured whose media
/// is readable, our integrated loudness and peak over the same range against CapCut's.
pub fn loudness_scan(root: &Path) -> Result<()> {
    let (mut diffs, mut peaks) = (Vec::new(), Vec::new());
    let mut seen = std::collections::HashSet::new();
    for (i, dir) in drafts(root)?.iter().enumerate() {
        let draft: Value = serde_json::from_slice(&std::fs::read(dir.join("draft_info.json"))?)?;
        let mats = &draft["materials"];
        let index = by_id(mats);
        for t in draft["tracks"].as_array().into_iter().flatten() {
            for seg in t["segments"].as_array().into_iter().flatten() {
                let Some((_, media)) = seg["material_id"].as_str().and_then(|id| index.get(id)) else { continue };
                let path = media["path"].as_str().unwrap_or_default();
                for r in seg["extra_material_refs"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                    let Some(("loudnesses", m)) = index.get(r).copied() else { continue };
                    let Some(theirs) = m.pointer("/loudness_param/avg_loudness").and_then(Value::as_f64) else { continue };
                    let range = &m["time_range"];
                    let (start, duration) = (range["start"].as_i64().unwrap_or(0), range["duration"].as_i64().unwrap_or(0));
                    if path.is_empty() || duration <= 0 || !seen.insert((path.to_string(), start, duration)) {
                        continue;
                    }
                    let Ok(Some(ours)) = openrip_audio::loudness::measure_file(Path::new(path), Micros(start), Some(Micros(duration))) else { continue };
                    let their_peak = m.pointer("/loudness_param/peak_loudness").and_then(Value::as_f64).unwrap_or(f64::NAN);
                    let Some(ours_i) = ours.integrated else { continue };
                    println!("draft #{i:02}: {:>7.2} s  CapCut {theirs:7.2} LUFS, peak {their_peak:6.2}  ours {ours_i:7.2} LUFS ({:+.2}), peak {:6.2} ({:+.2})", duration as f64 / 1e6, ours_i as f64 - theirs, ours.peak, ours.peak as f64 - their_peak);
                    diffs.push(ours_i as f64 - theirs);
                    peaks.push(ours.peak as f64 - their_peak);
                }
            }
        }
    }
    let stats = |v: &mut Vec<f64>| {
        v.sort_by(f64::total_cmp);
        let mean = v.iter().sum::<f64>() / v.len().max(1) as f64;
        (mean, v.first().copied().unwrap_or(0.0), v.last().copied().unwrap_or(0.0))
    };
    let (m, lo, hi) = stats(&mut diffs);
    let (pm, plo, phi) = stats(&mut peaks);
    println!("{} ranges: loudness ours − CapCut's mean {m:+.2} LU ({lo:+.2} … {hi:+.2}); peak mean {pm:+.2} dB ({plo:+.2} … {phi:+.2})", diffs.len());
    Ok(())
}

/// `beat-scan <projects-root>`: for every music clip whose CapCut beats file and media are
/// readable, our beats against CapCut's: the share of each found within 70 ms of the other's
/// (F-measure), the tempo, the mean offset of the matches, and how many of CapCut's bar
/// starts we call bar starts.
pub fn beat_scan(root: &Path) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    let (mut fs, mut downs) = (Vec::new(), Vec::new());
    for (i, dir) in drafts(root)?.iter().enumerate() {
        let draft: Value = serde_json::from_slice(&std::fs::read(dir.join("draft_info.json"))?)?;
        let index = by_id(&draft["materials"]);
        for t in draft["tracks"].as_array().into_iter().flatten() {
            for seg in t["segments"].as_array().into_iter().flatten() {
                let Some((_, media)) = seg["material_id"].as_str().and_then(|id| index.get(id)) else { continue };
                let path = media["path"].as_str().unwrap_or_default().to_string();
                for r in seg["extra_material_refs"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                    let Some(("beats", m)) = index.get(r).copied() else { continue };
                    let file = m.pointer("/ai_beats/beats_path").and_then(Value::as_str).unwrap_or_default();
                    if file.is_empty() || !Path::new(file).exists() || !Path::new(&path).exists() || !seen.insert(path.clone()) {
                        continue;
                    }
                    let theirs = openrip_capcut::beats_file(Path::new(file));
                    let Ok(Some(ours)) = openrip_audio::beats::detect_file(Path::new(&path)) else { continue };
                    let (tt, ot): (Vec<f64>, Vec<f64>) = (theirs.iter().map(|b| b.at.as_secs_f64()).collect(), ours.beats.iter().map(|b| b.at.as_secs_f64()).collect());
                    let near = |x: f64, set: &[f64]| set.iter().map(|y| y - x).min_by(|a, b| a.abs().total_cmp(&b.abs())).filter(|d| d.abs() <= 0.07);
                    let offsets: Vec<f64> = tt.iter().filter_map(|x| near(*x, &ot)).collect();
                    let recall = offsets.len() as f64 / tt.len().max(1) as f64;
                    let precision = ot.iter().filter(|x| near(**x, &tt).is_some()).count() as f64 / ot.len().max(1) as f64;
                    let f = if recall + precision > 0.0 { 2.0 * recall * precision / (recall + precision) } else { 0.0 };
                    let their_bpm = if tt.len() > 1 { 60.0 * (tt.len() - 1) as f64 / (tt[tt.len() - 1] - tt[0]) } else { 0.0 };
                    let offset = offsets.iter().sum::<f64>() / offsets.len().max(1) as f64;
                    // Of CapCut's bar starts that we have a beat at, how many we call bar starts.
                    let bars: Vec<bool> = theirs.iter().filter(|b| b.downbeat).filter_map(|b| ours.beats.iter().find(|o| (o.at.as_secs_f64() - b.at.as_secs_f64()).abs() <= 0.07).map(|o| o.downbeat)).collect();
                    let down = bars.iter().filter(|d| **d).count() as f64 / bars.len().max(1) as f64;
                    println!("draft #{i:02}: {} beats at {their_bpm:6.1} BPM; ours {} at {:6.1} BPM; F {f:.3} (recall {recall:.3}, precision {precision:.3}); offset {:+5.1} ms; bar starts {:.0}%", tt.len(), ot.len(), ours.bpm, offset * 1e3, down * 100.0);
                    if let Some(dir) = std::env::var_os("OPENRIP_BEATS_DUMP") {
                        let dump = serde_json::json!({ "theirs": tt, "ours": ot, "their_down": theirs.iter().map(|b| b.downbeat).collect::<Vec<_>>(), "our_down": ours.beats.iter().map(|b| b.downbeat).collect::<Vec<_>>(), "media": path });
                        std::fs::create_dir_all(&dir)?;
                        std::fs::write(PathBuf::from(dir).join(format!("d{i:02}-{}.json", fs.len())), dump.to_string())?;
                    }
                    // Sound effects come with a beat or two: only songs count.
                    if tt.len() < 8 {
                        continue;
                    }
                    fs.push(f);
                    downs.push(down);
                }
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    println!("{} songs: mean F {:.3}, bar starts agreed {:.0}%", fs.len(), mean(&fs), mean(&downs) * 100.0);
    Ok(())
}
