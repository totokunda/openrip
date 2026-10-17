//! Captions that follow the speech: the text shown a page of words at a time, the word being
//! spoken picked out.
//!
//! The timing is CapCut's caption script (`CaptionModule.lua`, shipped with its word-by-word
//! subtitle templates) as its exports show it (docs/parity/captions.md):
//! - Each word is held until the next one starts: across a pause of up to 1 s, or to the
//!   middle of a longer one.
//! - A page ends at the end of a sentence or after three words, and shows from its first
//!   word's start to its last word's (held) end; the first page also at its exact start.
//! - The clock wraps at the span from the first word's start to the last word's end.
//!
//! The clock starts at the caption animation's start, the clip's own in a draft. A clip whose
//! start was cut off in the editor (split, or trimmed) starts that far into the speech: its
//! animation starts before the clip.

use openrip_model::{Animation, AnimationKind, Micros, SpokenWord};

/// A pause between words up to this long (µs) is held by the word before it; a longer one
/// is split in the middle.
const HOLD_GAP: i64 = 1_000_000;

/// What a caption shows at one moment.
#[derive(Clone, Debug, PartialEq)]
pub struct CaptionFrame {
    /// The page: a character range of the text.
    pub page: (u32, u32),
    /// The page's words (character ranges of the text).
    pub words: Vec<(u32, u32)>,
    /// Which of `words` is being spoken.
    pub reading: Option<usize>,
    /// How the words are coloured.
    pub style: CaptionStyle,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CaptionStyle {
    /// The word being spoken keeps its colour (yellow where it's white); the page's other
    /// words are white.
    WordColor,
    /// Words keep their colours.
    Plain,
}

impl CaptionStyle {
    fn of(builtin: &str) -> Option<(CaptionStyle, usize)> {
        match builtin {
            "caption_word_color" => Some((CaptionStyle::WordColor, 3)),
            "caption_one_word" => Some((CaptionStyle::Plain, 1)),
            _ => None,
        }
    }

    /// Fill colour of a character of the page's word `word`, given its own colour.
    pub fn color(self, own: [u8; 4], reading: bool) -> [u8; 4] {
        match self {
            CaptionStyle::WordColor if reading => {
                let white = own[..3].iter().all(|&c| c as f32 / 255.0 > 0.95);
                if white { [255, 255, 0, 255] } else { own }
            }
            CaptionStyle::WordColor => [255, 255, 255, own[3]],
            CaptionStyle::Plain => own,
        }
    }
}

/// The caption at clip-local time `t`: `None` when the clip has no caption animation OpenRip
/// draws (the text shows whole), `Some(None)` when no page shows.
pub fn caption_frame<'a>(animations: impl IntoIterator<Item = &'a Animation>, text: &str, words: &[SpokenWord], t: Micros) -> Option<Option<CaptionFrame>> {
    let (style, per_page, start) = animations.into_iter().filter(|a| a.kind == AnimationKind::Caption).find_map(|a| CaptionStyle::of(a.builtin.as_deref()?).map(|(s, n)| (s, n, a.start)))?;
    if words.is_empty() {
        return None;
    }
    let (pack, timed) = held(words);
    let first = pack.iter().map(|w| w.0).min().unwrap_or(0);
    let last = pack.iter().map(|w| w.1).max().unwrap_or(0);
    let span = last - first;
    if span <= 0 {
        return Some(None);
    }
    // Nothing before the caption's clock starts.
    let t = t.0 - start.0;
    if t < 0 {
        return Some(None);
    }
    let t = t.rem_euclid(span);
    let chars: Vec<char> = text.chars().collect();
    let sentence_end = |r: (u32, u32)| chars.get(r.1 as usize - 1).is_some_and(|c| matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？'));
    // Pages: words up to a sentence end, three at a time.
    let mut pages: Vec<std::ops::Range<usize>> = Vec::new();
    let mut start = 0;
    for (k, w) in words.iter().enumerate() {
        if k + 1 - start == per_page || sentence_end(w.range) || k + 1 == words.len() {
            pages.push(start..k + 1);
            start = k + 1;
        }
    }
    for (n, page) in pages.iter().enumerate() {
        let (from, to) = (timed[page.start].1, timed[page.end - 1].2);
        let shows = if n == 0 { from <= t && t <= to } else { from < t && t <= to };
        if !shows {
            continue;
        }
        let reading = page.clone().rfind(|&k| timed[k].1 <= t && t < timed[k].2).map(|k| k - page.start);
        return Some(Some(CaptionFrame {
            page: (words[page.start].range.0, words[page.end - 1].range.1),
            words: words[page.clone()].iter().map(|w| w.range).collect(),
            reading,
            style,
        }));
    }
    Some(None)
}

/// Each word's (start, end) once pauses are held (its end runs on to the next word's start,
/// or the middle of a pause over [`HOLD_GAP`]), and its (index, start, end) when it's picked
/// out: from no earlier than the word before starts to no later than the word after ends.
#[allow(clippy::type_complexity)]
fn held(words: &[SpokenWord]) -> (Vec<(i64, i64)>, Vec<(usize, i64, i64)>) {
    let mut pack: Vec<(i64, i64)> = words.iter().map(|w| (w.start.0, w.end.0)).collect();
    for k in 0..words.len().saturating_sub(1) {
        let (end, next) = (words[k].end.0, words[k + 1].start.0);
        if next >= end {
            let gap = next - end;
            pack[k].1 = if gap > HOLD_GAP { end + gap / 2 } else { next };
        }
    }
    let timed = (0..words.len())
        .map(|k| {
            let start = if k > 0 { pack[k].0.max(pack[k - 1].0) } else { pack[k].0 };
            let end = if k + 1 < words.len() { pack[k].1.min(pack[k + 1].1) } else { pack[k].1 };
            (k, start, end)
        })
        .collect();
    (pack, timed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caption() -> Animation {
        Animation { kind: AnimationKind::Caption, start: Micros(0), duration: Micros(10_000_000), builtin: Some("caption_word_color".into()), library: None, resource: None }
    }

    /// Words of `text` (split at spaces) spoken at the given (start, end) ms.
    fn spoken(text: &str, times: &[(i64, i64)]) -> Vec<SpokenWord> {
        let mut out = Vec::new();
        let mut at = 0u32;
        for (w, &(s, e)) in text.split(' ').zip(times) {
            let n = w.chars().count() as u32;
            out.push(SpokenWord { range: (at, at + n), start: Micros(s * 1000), end: Micros(e * 1000) });
            at += n + 1;
        }
        out
    }

    fn at(text: &str, words: &[SpokenWord], ms: i64) -> Option<(String, Option<String>)> {
        let f = caption_frame([&caption()], text, words, Micros(ms * 1000)).unwrap()?;
        let sub = |r: (u32, u32)| text.chars().skip(r.0 as usize).take((r.1 - r.0) as usize).collect::<String>();
        Some((sub(f.page), f.reading.map(|k| sub(f.words[k]))))
    }

    #[test]
    fn pages_of_three_words_with_the_spoken_word_held_through_short_pauses() {
        let text = "one two three four five";
        let w = spoken(text, &[(0, 400), (600, 900), (900, 1200), (1300, 1600), (1600, 2000)]);
        assert_eq!(at(text, &w, 0), Some(("one two three".into(), Some("one".into()))));
        // The 200 ms pause after "one" is held by it.
        assert_eq!(at(text, &w, 500), Some(("one two three".into(), Some("one".into()))));
        assert_eq!(at(text, &w, 1250), Some(("one two three".into(), Some("three".into()))));
        assert_eq!(at(text, &w, 1301), Some(("four five".into(), Some("four".into()))));
        assert_eq!(at(text, &w, 1999), Some(("four five".into(), Some("five".into()))));
    }

    #[test]
    fn a_long_pause_is_split_and_nothing_shows_in_its_second_half() {
        let text = "one two three four";
        let w = spoken(text, &[(0, 400), (500, 800), (900, 1000), (4000, 4500)]);
        // "three" holds to the middle of the 3 s pause (2500), then no page shows until "four".
        assert_eq!(at(text, &w, 2400), Some(("one two three".into(), Some("three".into()))));
        assert_eq!(at(text, &w, 3000), None);
        assert_eq!(at(text, &w, 4100), Some(("four".into(), Some("four".into()))));
    }

    #[test]
    fn a_sentence_end_ends_the_page() {
        let text = "one two. three four";
        let w = spoken(text, &[(0, 400), (400, 800), (800, 1200), (1200, 1600)]);
        assert_eq!(at(text, &w, 600), Some(("one two.".into(), Some("two.".into()))));
        assert_eq!(at(text, &w, 900), Some(("three four".into(), Some("three".into()))));
    }

    #[test]
    fn an_unspoken_word_shows_but_is_never_picked_out() {
        let text = "one two three";
        let w = spoken(text, &[(600, 600), (600, 900), (900, 1500)]);
        // The page starts with the first word, at 600; the clock wraps at 1500 - 600.
        assert_eq!(at(text, &w, 300), None);
        assert_eq!(at(text, &w, 700), Some(("one two three".into(), Some("two".into()))));
    }

    #[test]
    fn a_caption_cut_off_at_its_start_keeps_time_with_the_speech() {
        let text = "one two three four five six";
        let w = spoken(text, &[(0, 400), (400, 800), (800, 1200), (1200, 1600), (1600, 2000), (2000, 2400)]);
        // The second half of a split at 1.3 s: its animation started 1.3 s before it.
        let half = Animation { start: Micros(-1_300_000), ..caption() };
        let f = caption_frame([&half], text, &w, Micros(0)).unwrap().unwrap();
        assert_eq!((f.words.len(), f.reading), (3, Some(0)));
        assert_eq!(f.page, (14, 27));
        // Extended 0.5 s before its start: nothing until the speech's clock starts.
        let early = Animation { start: Micros(500_000), ..caption() };
        assert_eq!(caption_frame([&early], text, &w, Micros(300_000)), Some(None));
        assert!(caption_frame([&early], text, &w, Micros(600_000)).unwrap().is_some());
    }

    #[test]
    fn white_turns_yellow_while_spoken_other_colours_stay() {
        let s = CaptionStyle::WordColor;
        assert_eq!(s.color([255, 255, 255, 200], true), [255, 255, 0, 255]);
        assert_eq!(s.color([0, 200, 30, 255], true), [0, 200, 30, 255]);
        assert_eq!(s.color([255, 239, 0, 128], false), [255, 255, 255, 128]);
    }
}
