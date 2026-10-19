//! What a recognizer hands back: segments of words with times, and how a recognizer's tokens
//! (pieces of words, with a time each) are put together into words.

use serde::Serialize;

/// A spoken word. Times are microseconds from the start of the audio.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Word {
    /// The word with any punctuation that belongs to it ("world.", "it's", "don't,").
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
}

/// A stretch of speech the recognizer set apart (a sentence or part of one).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Segment {
    pub start_us: i64,
    pub end_us: i64,
    pub words: Vec<Word>,
}

/// A transcript: the words in order, in segments, and the language heard.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Transcript {
    /// ISO 639-1 code ("en", "es", "zh"), as detected or asked for.
    pub language: String,
    pub segments: Vec<Segment>,
}

impl Transcript {
    pub fn words(&self) -> impl Iterator<Item = &Word> {
        self.segments.iter().flat_map(|s| s.words.iter())
    }

    /// The plain text, words joined by spaces (no space between Chinese or Japanese words).
    pub fn text(&self) -> String {
        join(self.words().map(|w| w.text.as_str()))
    }
}

/// A recognizer's token: a piece of a word (or a whole word), its text as the model has it
/// (a word's first token carries the space before it), and when it was spoken.
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
}

/// True for characters of scripts written without spaces between words, where every token
/// starts a word of its own.
pub(crate) fn is_unspaced(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30FF   // Hiragana, Katakana
        | 0x3400..=0x4DBF // CJK extension A
        | 0x4E00..=0x9FFF // CJK
        | 0xF900..=0xFAFF
        | 0x0E00..=0x0E7F // Thai
        | 0x0E80..=0x0EFF // Lao
        | 0x1000..=0x109F // Myanmar
        | 0x1780..=0x17FF // Khmer
        | 0xFF00..=0xFFEF // full-width forms
        | 0x3000..=0x303F) // CJK punctuation
}

/// Join words with spaces, except between two characters of unspaced scripts.
pub fn join<'a>(words: impl IntoIterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for w in words {
        if let (Some(last), Some(first)) = (out.chars().last(), w.chars().next()) {
            if !(is_unspaced(last) || is_unspaced(first)) {
                out.push(' ');
            }
        }
        out.push_str(w);
    }
    out
}

/// Words from tokens. A token whose text starts with a space starts a word; so does one
/// that starts with a character of an unspaced script; any other continues the word before
/// it (a suffix, an apostrophe, punctuation). Each word runs from its first token's start to
/// its last token's end. Times are then made orderly: a word never starts before the one
/// before it ended, and none is shorter than 20 ms (a recognizer's estimates overlap and
/// collapse at times).
pub fn words_from_tokens(tokens: &[Token]) -> Vec<Word> {
    let mut words: Vec<Word> = Vec::new();
    for t in tokens {
        let trimmed = t.text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let starts_word = t.text.starts_with(char::is_whitespace) || trimmed.chars().next().is_some_and(is_unspaced) || words.is_empty();
        // Punctuation on its own never starts a word.
        let only_punct = trimmed.chars().all(|c| c.is_ascii_punctuation() && c != '$' && c != '%' && c != '#' || matches!(c, '…' | '。' | '、' | '！' | '？' | '，'));
        match words.last_mut() {
            Some(last) if !starts_word || only_punct => {
                last.text.push_str(trimmed);
                last.end_us = last.end_us.max(t.end_us);
            }
            _ => words.push(Word { text: trimmed.to_string(), start_us: t.start_us, end_us: t.end_us }),
        }
    }
    let mut floor = 0;
    for w in &mut words {
        w.start_us = w.start_us.max(floor);
        w.end_us = w.end_us.max(w.start_us + 20_000);
        floor = w.end_us;
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(text: &str, a: i64, b: i64) -> Token {
        Token { text: text.into(), start_us: a * 1000, end_us: b * 1000 }
    }

    #[test]
    fn tokens_make_words_at_their_spaces() {
        let words = words_from_tokens(&[tok(" The", 0, 200), tok(" quick", 200, 500), tok(" brown", 500, 650), tok(" fox", 650, 900), tok(".", 900, 900)]);
        let text: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(text, ["The", "quick", "brown", "fox."]);
        assert_eq!((words[3].start_us, words[3].end_us), (650_000, 900_000));
    }

    #[test]
    fn pieces_of_a_word_and_apostrophes_join_it() {
        let words = words_from_tokens(&[tok(" Un", 0, 100), tok("believ", 100, 300), tok("able", 300, 500), tok(" don", 600, 700), tok("'t", 700, 800), tok(" go", 800, 900)]);
        let text: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(text, ["Unbelievable", "don't", "go"]);
        assert_eq!((words[0].start_us, words[0].end_us), (0, 500_000));
    }

    #[test]
    fn overlapping_or_empty_times_are_made_orderly() {
        let words = words_from_tokens(&[tok(" a", 100, 400), tok(" b", 300, 300), tok(" c", 250, 260)]);
        assert_eq!(words[1].start_us, 400_000);
        assert!(words.iter().all(|w| w.end_us - w.start_us >= 20_000));
        assert!(words.windows(2).all(|w| w[0].end_us <= w[1].start_us));
    }

    #[test]
    fn unspaced_scripts_start_a_word_per_token_and_join_without_spaces() {
        let words = words_from_tokens(&[tok("你", 0, 200), tok("好", 200, 400), tok("。", 400, 450)]);
        assert_eq!(words.len(), 2);
        assert_eq!(words[1].text, "好。");
        assert_eq!(join(["你", "好。", "hello", "world"]), "你好。hello world");
    }
}
