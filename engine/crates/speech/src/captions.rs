//! From a transcript to captions: the words split into short lines a viewer can read, each
//! with when it appears and when each of its words is spoken. Pure: no model, no audio, so it
//! runs wherever the engine does.
//!
//! Splitting: a caption is closed before the word that would make it longer than the line
//! allows, after a pause, after a sentence's end (once it has a few words) and when it has
//! been on screen too long. A caption of two lines is broken near its middle. Fillers (um, uh
//! and a "like" set off by commas) can be left out, and words worth picking out (names,
//! numbers and a word said more than once) flagged: no second model, a stop-word list and
//! counts.

use std::collections::HashMap;

use serde::Serialize;

use crate::transcript::{is_unspaced, Transcript};

/// How a transcript is cut into captions.
#[derive(Clone, Debug)]
pub struct CaptionOptions {
    /// Longest line, in characters.
    pub max_chars: usize,
    /// Lines in a caption (1 or 2).
    pub max_lines: usize,
    /// Longest a caption stays up, seconds.
    pub max_secs: f64,
    /// A pause between words this long (seconds) starts a new caption.
    pub pause_secs: f64,
    /// Leave out um, uh, er, hmm and a "like" set off by commas.
    pub remove_fillers: bool,
    /// Flag the words worth picking out.
    pub highlight_keywords: bool,
}

impl Default for CaptionOptions {
    fn default() -> Self {
        CaptionOptions { max_chars: 32, max_lines: 1, max_secs: 5.0, pause_secs: 0.7, remove_fillers: false, highlight_keywords: false }
    }
}

/// A word of a caption.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CaptionWord {
    /// Character range `[start, end)` into the caption's text (Unicode scalar values).
    pub range: (u32, u32),
    /// When it's spoken, from the caption's start.
    pub start_us: i64,
    pub end_us: i64,
    /// A word to pick out (names, numbers, words said again).
    pub keyword: bool,
}

/// A caption: its text (lines joined by "\n"), when it shows on the audio's timeline, and its
/// words.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Caption {
    pub start_us: i64,
    pub end_us: i64,
    pub text: String,
    pub words: Vec<CaptionWord>,
}

#[derive(Clone, Debug)]
struct W {
    text: String,
    start: i64,
    end: i64,
    keyword: bool,
}

/// A caption stays up this long (µs) after its last word if the next one isn't sooner.
const HOLD: i64 = 300_000;
/// And at least this long if there's room.
const MIN_SHOWN: i64 = 400_000;

const ALWAYS_FILLERS: &[&str] = &["um", "umm", "uhm", "uh", "uhh", "er", "erm", "hm", "hmm", "mm", "mmm", "mhm"];

fn letters(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn ends_sentence(s: &str) -> bool {
    s.trim_end_matches(['"', '\'', ')', '”', '’']).ends_with(['.', '!', '?', '…', '。', '！', '？'])
}

/// A word that is no part of the speech: um, uh, er, hmm; or "like" set off by commas.
pub fn is_filler(text: &str) -> bool {
    let norm = letters(text);
    ALWAYS_FILLERS.contains(&norm.as_str()) || (norm == "like" && text.trim_end().ends_with(','))
}

/// The transcript's words with the fillers taken out. A filler that closed a sentence hands
/// its punctuation to the word before.
fn without_fillers(words: Vec<W>) -> Vec<W> {
    let mut out: Vec<W> = Vec::new();
    for w in words {
        if is_filler(&w.text) {
            let stop = w.text.trim_end().chars().last().filter(|c| matches!(c, '.' | '?' | '!'));
            if let (Some(c), Some(prev)) = (stop, out.last_mut()) {
                if !ends_sentence(&prev.text) {
                    prev.text = prev.text.trim_end_matches([',', ';', ':']).to_string();
                    prev.text.push(c);
                }
            }
            continue;
        }
        out.push(w);
    }
    out
}

const STOP_WORDS: &[&str] = &[
    "about", "after", "again", "also", "always", "another", "because", "been", "before", "being", "between", "both", "could", "does", "doing", "done", "down", "each", "even", "every", "from", "gonna", "have", "having", "here", "into", "just", "know", "like", "make", "many", "more", "most", "much", "must", "never", "only", "other", "over", "really", "should", "since", "some", "something", "still", "such", "than", "that", "their", "them", "then", "there", "these", "they", "thing", "things", "think", "this", "those", "through", "very", "want", "well", "were", "what", "when", "where", "which", "while", "will", "with", "would", "your", "yeah", "okay", "right", "going", "come", "back", "good", "little", "need", "said", "same", "take", "tell", "them", "time", "today", "using", "wanna",
];

/// Flag the words to pick out: numbers, names (capitalised in the middle of a sentence) and
/// words of five letters or more said again, none of them a common word.
fn flag_keywords(words: &mut [W], english: bool) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for w in words.iter() {
        *counts.entry(letters(&w.text)).or_default() += 1;
    }
    let mut sentence_start = true;
    for w in words.iter_mut() {
        let norm = letters(&w.text);
        let common = english && STOP_WORDS.contains(&norm.as_str());
        let numeric = norm.chars().any(|c| c.is_ascii_digit());
        let name = !sentence_start && w.text.chars().next().is_some_and(char::is_uppercase) && norm.chars().count() >= 3 && norm != "i" && !norm.starts_with("i'") && english;
        let again = norm.chars().count() >= 5 && counts[&norm] >= if english { 2 } else { 3 };
        w.keyword = !is_filler(&w.text) && !norm.is_empty() && (numeric || (!common && (name || again)));
        sentence_start = ends_sentence(&w.text);
    }
}

/// Words joined for display: a space between them except where a script has none.
fn separator(a: &str, b: &str) -> &'static str {
    match (a.chars().last(), b.chars().next()) {
        (Some(x), Some(y)) if is_unspaced(x) || is_unspaced(y) => "",
        _ => " ",
    }
}

fn line_len(words: &[W]) -> usize {
    words.iter().enumerate().map(|(i, w)| w.text.chars().count() + if i > 0 { separator(&words[i - 1].text, &w.text).len() } else { 0 }).sum()
}

/// Where to break a caption's words in two: the break that leaves the longer line shortest.
fn balanced_break(words: &[W]) -> usize {
    (1..words.len()).min_by_key(|&k| line_len(&words[..k]).max(line_len(&words[k..]))).unwrap_or(words.len())
}

/// Cut `transcript` into captions.
pub fn build_captions(transcript: &Transcript, options: &CaptionOptions) -> Vec<Caption> {
    let mut all: Vec<W> = transcript.words().map(|w| W { text: w.text.clone(), start: w.start_us, end: w.end_us, keyword: false }).collect();
    if options.remove_fillers {
        all = without_fillers(all);
    }
    if options.highlight_keywords {
        flag_keywords(&mut all, transcript.language == "en");
    }
    let limit = options.max_chars.max(1) * options.max_lines.clamp(1, 2);
    let pause = (options.pause_secs * 1e6) as i64;
    let longest = (options.max_secs * 1e6) as i64;
    let mut groups: Vec<Vec<W>> = Vec::new();
    let mut cur: Vec<W> = Vec::new();
    for w in all {
        if let Some(last) = cur.last() {
            let joined = line_len(&cur) + separator(&last.text, &w.text).len() + w.text.chars().count();
            let sentence_done = ends_sentence(&last.text) && cur.len() >= 2;
            let soft = last.text.ends_with([',', ';', ':']) && line_len(&cur) * 10 >= limit * 6;
            if joined > limit || w.start - last.end > pause || w.end - cur[0].start > longest || sentence_done || soft {
                groups.push(std::mem::take(&mut cur));
            }
        }
        cur.push(w);
    }
    if !cur.is_empty() {
        groups.push(cur);
    }
    let mut out: Vec<Caption> = groups
        .iter()
        .map(|g| {
            let break_at = if options.max_lines >= 2 && line_len(g) > options.max_chars { balanced_break(g) } else { g.len() };
            let start = g[0].start;
            let mut text = String::new();
            let mut words = Vec::new();
            let mut at = 0u32;
            for (k, w) in g.iter().enumerate() {
                if k > 0 {
                    let sep = if k == break_at { "\n" } else { separator(&g[k - 1].text, &w.text) };
                    text.push_str(sep);
                    at += sep.chars().count() as u32;
                }
                let n = w.text.chars().count() as u32;
                text.push_str(&w.text);
                words.push(CaptionWord { range: (at, at + n), start_us: w.start - start, end_us: w.end - start, keyword: w.keyword });
                at += n;
            }
            Caption { start_us: start, end_us: g[g.len() - 1].end, text, words }
        })
        .collect();
    // On screen a moment after the last word, at least a moment, never into the next caption.
    for k in 0..out.len() {
        let room = out.get(k + 1).map_or(i64::MAX, |n| n.start_us);
        let c = &mut out[k];
        c.end_us = (c.end_us + HOLD).max(c.start_us + MIN_SHOWN).min(room).max(c.start_us + 1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{Segment, Word};

    /// Words of `text` spoken `per` ms each from `at` ms, with `gap` ms between.
    fn say(text: &str, at: i64, per: i64, gap: i64) -> Vec<Word> {
        let mut t = at;
        text.split_whitespace()
            .map(|w| {
                let word = Word { text: w.into(), start_us: t * 1000, end_us: (t + per) * 1000 };
                t += per + gap;
                word
            })
            .collect()
    }

    fn transcript(parts: Vec<Vec<Word>>) -> Transcript {
        Transcript {
            language: "en".into(),
            segments: parts.into_iter().map(|w| Segment { start_us: w[0].start_us, end_us: w[w.len() - 1].end_us, words: w }).collect(),
        }
    }

    #[test]
    fn lines_split_by_length_at_word_boundaries() {
        let t = transcript(vec![say("the quick brown fox jumps over the lazy dog and keeps running far away", 0, 300, 0)]);
        let caps = build_captions(&t, &CaptionOptions { max_chars: 20, ..Default::default() });
        assert!(caps.len() >= 4);
        for c in &caps {
            assert!(c.text.chars().count() <= 20, "{:?}", c.text);
            assert!(!c.text.contains('\n'));
        }
        let rejoined: String = caps.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ");
        assert_eq!(rejoined, "the quick brown fox jumps over the lazy dog and keeps running far away");
    }

    #[test]
    fn a_long_caption_breaks_near_its_middle_when_two_lines_are_allowed() {
        let t = transcript(vec![say("this is a fairly long caption", 0, 300, 0)]);
        let caps = build_captions(&t, &CaptionOptions { max_chars: 16, max_lines: 2, ..Default::default() });
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].text, "this is a fairly\nlong caption");
        // The words' ranges count the newline as one character.
        let chars: Vec<char> = caps[0].text.chars().collect();
        let last = caps[0].words.last().unwrap();
        assert_eq!(chars[last.range.0 as usize..last.range.1 as usize].iter().collect::<String>(), "caption");
    }

    #[test]
    fn words_keep_their_own_times_from_the_captions_start() {
        let t = transcript(vec![say("hello there", 1000, 400, 100)]);
        let caps = build_captions(&t, &CaptionOptions::default());
        assert_eq!(caps.len(), 1);
        let c = &caps[0];
        assert_eq!(c.start_us, 1_000_000);
        assert_eq!(c.text, "hello there");
        assert_eq!(c.words[0], CaptionWord { range: (0, 5), start_us: 0, end_us: 400_000, keyword: false });
        assert_eq!(c.words[1], CaptionWord { range: (6, 11), start_us: 500_000, end_us: 900_000, keyword: false });
        // Held 0.3 s after the last word.
        assert_eq!(c.end_us, 1_900_000 + HOLD);
    }

    #[test]
    fn a_pause_or_a_sentences_end_starts_a_new_caption() {
        let mut first = say("so we begin", 0, 300, 0);
        let second = say("then after a long pause", 4000, 300, 0);
        first.extend(second);
        let caps = build_captions(&transcript(vec![first]), &CaptionOptions::default());
        assert_eq!(caps.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), ["so we begin", "then after a long pause"]);

        let t = transcript(vec![say("It works. Now the next one follows", 0, 300, 0)]);
        let caps = build_captions(&t, &CaptionOptions { max_chars: 60, ..Default::default() });
        assert_eq!(caps.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), ["It works.", "Now the next one follows"]);
    }

    #[test]
    fn a_caption_is_never_up_into_the_next() {
        let t = transcript(vec![say("one two three four five six seven eight nine ten eleven", 0, 100, 0)]);
        let caps = build_captions(&t, &CaptionOptions { max_chars: 12, ..Default::default() });
        for pair in caps.windows(2) {
            assert!(pair[0].end_us <= pair[1].start_us);
        }
        assert!(caps.iter().all(|c| c.end_us > c.start_us));
    }

    #[test]
    fn fillers_come_out_and_a_real_like_stays() {
        let t = transcript(vec![say("So um I uh think, like, it works. I like pizza", 0, 200, 0)]);
        let plain = build_captions(&t, &CaptionOptions { max_chars: 100, ..Default::default() });
        assert!(plain.iter().any(|c| c.text.contains("um")));
        let clean = build_captions(&t, &CaptionOptions { max_chars: 100, remove_fillers: true, ..Default::default() });
        let text = clean.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ");
        assert_eq!(text, "So I think, it works. I like pizza");
        // Times are still the words' own.
        assert_eq!(clean[0].words[1].start_us, 400_000);
    }

    #[test]
    fn a_filler_that_ends_a_sentence_gives_its_full_stop_to_the_word_before() {
        let t = transcript(vec![say("That is all, um.", 0, 200, 0)]);
        let clean = build_captions(&t, &CaptionOptions { max_chars: 100, remove_fillers: true, ..Default::default() });
        assert_eq!(clean[0].text, "That is all.");
    }

    #[test]
    fn names_numbers_and_repeated_words_are_the_keywords() {
        let t = transcript(vec![say("Yesterday I met Sarah in Paris and the weather in Paris was great for 3 hours", 0, 200, 0)]);
        let caps = build_captions(&t, &CaptionOptions { max_chars: 100, highlight_keywords: true, ..Default::default() });
        let flagged: Vec<_> = caps[0]
            .words
            .iter()
            .filter(|w| w.keyword)
            .map(|w| caps[0].text.chars().skip(w.range.0 as usize).take((w.range.1 - w.range.0) as usize).collect::<String>())
            .collect();
        assert_eq!(flagged, ["Sarah", "Paris", "Paris", "3"]);
    }

    #[test]
    fn chinese_words_join_without_spaces() {
        let t = Transcript {
            language: "zh".into(),
            segments: vec![Segment {
                start_us: 0,
                end_us: 800_000,
                words: vec![Word { text: "你".into(), start_us: 0, end_us: 400_000 }, Word { text: "好".into(), start_us: 400_000, end_us: 800_000 }],
            }],
        };
        let caps = build_captions(&t, &CaptionOptions::default());
        assert_eq!(caps[0].text, "你好");
        assert_eq!(caps[0].words[1].range, (1, 2));
    }
}
