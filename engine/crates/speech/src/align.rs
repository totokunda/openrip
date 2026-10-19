//! Word times tightened against the sound. A recognizer's alignment says where a word ends
//! well (Whisper's DTW alignment is within a few tens of ms) but starts it where the word
//! before ended, so a word after a pause begins early, inside the silence. Here each word's
//! start moves up to where its sound begins, and its end back to where the sound stops,
//! judged by the short-time energy of the audio itself. Pure: samples in, times out.

use crate::backend::SAMPLE_RATE;
use crate::transcript::Transcript;

/// Energy frames are 10 ms.
const FRAME: usize = SAMPLE_RATE as usize / 100;
/// A word's sound is what rises above this fraction of its own loudest frame (but never
/// within a few times the room's noise).
const FRACTION: f32 = 0.08;
/// The sound has to last this many frames, so a click doesn't start a word.
const SUSTAIN: usize = 3;

fn frame_rms(audio: &[f32]) -> Vec<f32> {
    audio.chunks(FRAME).map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt()).collect()
}

/// Tighten the words' starts and ends to the sound in `audio` (16 kHz mono, from the same
/// instant as the transcript's times). Words stay in order and never overlap.
pub fn tighten(transcript: &mut Transcript, audio: &[f32]) {
    let energy = frame_rms(audio);
    if energy.len() < 4 {
        return;
    }
    // The room: the quietest fifth of the frames.
    let mut sorted = energy.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[sorted.len() / 5].max(1e-5);
    let to_frame = |us: i64| (us.max(0) as usize * 100 / 1_000_000).min(energy.len() - 1);
    let mut floor_us = 0i64;
    for seg in &mut transcript.segments {
        let n = seg.words.len();
        for (k, w) in seg.words.iter_mut().enumerate() {
            // A segment's first word may have begun up to 0.3 s before the recognizer says.
            let back = if k == 0 { 300_000 } else { 0 };
            let a = to_frame((w.start_us - back).max(floor_us));
            let b = to_frame(w.end_us.max(w.start_us)).max(a);
            let peak = energy[a..=b].iter().cloned().fold(0.0, f32::max);
            let threshold = (peak * FRACTION).max(floor * 3.0);
            let loud = |i: usize| energy[i] >= threshold;
            let sustained = |i: usize| (i..(i + SUSTAIN).min(b + 1)).all(loud);
            if peak > floor * 3.0 {
                if let Some(first) = (a..=b).find(|&i| sustained(i)) {
                    let mut last = (first..=b).rev().find(|&i| loud(i)).unwrap_or(first);
                    // A word may run on past where the alignment ended it, as the sound decays:
                    // by up to 0.2 s if it dies away in that time (so its tail isn't taken for
                    // the next word's start), and the segment's last word by up to 0.4 s.
                    if last == b {
                        let limit = if k + 1 == n { 40 } else { 20 };
                        let mut i = b;
                        while i + 1 < energy.len() && i < b + limit && loud(i + 1) {
                            i += 1;
                        }
                        if k + 1 == n || i + 1 >= energy.len() || !loud(i + 1) {
                            last = i;
                        }
                    }
                    // A frame of lead before the sound, and the frame it ends in.
                    let start = (first as i64 * 10_000 - 10_000).max(0);
                    let end = (last as i64 + 1) * 10_000;
                    w.start_us = start.max(floor_us);
                    w.end_us = end.max(w.start_us + 40_000);
                }
            }
            floor_us = w.end_us;
        }
        if let (Some(first), Some(last)) = (seg.words.first(), seg.words.last()) {
            seg.start_us = first.start_us;
            seg.end_us = last.end_us;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{Segment, Word};

    /// 16 kHz audio of silence with a tone burst from `from` ms to `to` ms.
    fn burst(total_ms: usize, bursts: &[(usize, usize)]) -> Vec<f32> {
        let mut a = vec![0.0f32; total_ms * 16];
        for &(from, to) in bursts {
            for i in from * 16..to * 16 {
                a[i] = 0.3 * (i as f32 * 0.2).sin();
            }
        }
        a
    }

    fn word(text: &str, a: i64, b: i64) -> Word {
        Word { text: text.into(), start_us: a * 1000, end_us: b * 1000 }
    }

    #[test]
    fn a_word_after_a_pause_starts_where_its_sound_does() {
        // "one" is spoken 100-400 ms, "two" 1200-1500; the recognizer ends "one" right and
        // starts "two" where "one" ended.
        let audio = burst(2000, &[(100, 400), (1200, 1500)]);
        let mut t = Transcript { language: "en".into(), segments: vec![Segment { start_us: 0, end_us: 1_500_000, words: vec![word("one", 90, 420), word("two", 420, 1510)] }] };
        tighten(&mut t, &audio);
        let [one, two] = &t.segments[0].words[..] else { panic!() };
        assert!((one.start_us - 100_000).abs() <= 20_000, "{}", one.start_us);
        assert!((one.end_us - 400_000).abs() <= 20_000, "{}", one.end_us);
        assert!((two.start_us - 1_200_000).abs() <= 20_000, "{}", two.start_us);
        assert!((two.end_us - 1_500_000).abs() <= 20_000, "{}", two.end_us);
        assert_eq!((t.segments[0].start_us, t.segments[0].end_us), (one.start_us, two.end_us));
    }

    #[test]
    fn words_in_unbroken_speech_keep_their_times_and_order() {
        let audio = burst(1000, &[(100, 900)]);
        let mut t = Transcript { language: "en".into(), segments: vec![Segment { start_us: 100_000, end_us: 900_000, words: vec![word("a", 100, 500), word("b", 500, 900)] }] };
        tighten(&mut t, &audio);
        let w = &t.segments[0].words;
        assert!((w[0].start_us - 100_000).abs() <= 20_000);
        assert!((w[0].end_us - 500_000).abs() <= 20_000 || w[0].end_us <= w[1].start_us);
        assert!(w[0].end_us <= w[1].start_us && w[1].end_us <= 910_000);
    }

    #[test]
    fn silence_changes_nothing() {
        let mut t = Transcript { language: "en".into(), segments: vec![Segment { start_us: 0, end_us: 500_000, words: vec![word("hm", 0, 500)] }] };
        let before = t.clone();
        tighten(&mut t, &vec![0.0; 16_000]);
        assert_eq!(t, before);
    }
}
