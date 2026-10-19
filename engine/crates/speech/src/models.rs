//! The Whisper models on offer: ggml files from `ggerganov/whisper.cpp` on Hugging Face
//! (the weights are OpenAI's, MIT licensed), with the size and SHA-256 each file must have.
//!
//! The catalog is data, so every client shows the same list; downloading is the client's
//! (the desktop app does it from its main process into the user's app data, then checks the
//! size and checksum against these).

use serde::Serialize;

/// One downloadable model.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Model {
    /// The short name used on the command line and in settings: `base.en`, `small`, …
    pub id: &'static str,
    /// What a menu calls it.
    pub label: &'static str,
    /// The file name, also what it's called on disk: `ggml-base.en.bin`.
    pub file: &'static str,
    /// English only (the `.en` models: a little better at English than the same size
    /// multilingual one).
    pub english_only: bool,
    /// The file's size in bytes.
    pub size: u64,
    /// The file's SHA-256, lower-case hex.
    pub sha256: &'static str,
    /// A line on what it's good for.
    pub note: &'static str,
}

/// The model the app picks until the user chooses: multilingual (so the language menu and
/// auto-detect work) and `small`, the smallest that gets words like "vlog" right where `base`
/// writes "blog" (docs/plan/auto-captions.md). It's 488 MB to download once, but on Apple
/// silicon's GPU it runs at about 20x real time, so a ten-minute clip takes half a minute;
/// `base` (148 MB, 40x) is one click away in the model list.
pub const DEFAULT_MODEL: &str = "small";

/// Where a model file is served from.
pub fn url(model: &Model) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", model.file)
}

const fn m(id: &'static str, label: &'static str, english_only: bool, size: u64, sha256: &'static str, note: &'static str) -> Model {
    // `file` is built by hand below: const fns can't format.
    Model { id, label, file: "", english_only, size, sha256, note }
}

macro_rules! model {
    ($id:literal, $label:literal, $en:literal, $size:literal, $sha:literal, $note:literal) => {
        Model { file: concat!("ggml-", $id, ".bin"), ..m($id, $label, $en, $size, $sha, $note) }
    };
}

/// Every model, smallest first.
pub const MODELS: &[Model] = &[
    model!("tiny", "Tiny", false, 77_691_713, "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21", "Fastest; rough on accents and noise"),
    model!("tiny.en", "Tiny (English)", true, 77_704_715, "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f", "Fastest, English only"),
    model!("base", "Base", false, 147_951_465, "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", "Good for clear speech in any language"),
    model!("base.en", "Base (English)", true, 147_964_211, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002", "Good for clear English speech"),
    model!("small", "Small", false, 487_601_967, "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b", "Better with accents and background noise"),
    model!("small.en", "Small (English)", true, 487_614_201, "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d", "Better English with noise and accents"),
    model!("medium", "Medium", false, 1_533_763_059, "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208", "Accurate; slower"),
    model!("medium.en", "Medium (English)", true, 1_533_774_781, "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356", "Accurate English; slower"),
    model!("large-v3-turbo-q5_0", "Large v3 Turbo (compact)", false, 574_041_195, "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", "Near large-model accuracy in 574 MB"),
    model!("large-v3-turbo", "Large v3 Turbo", false, 1_624_555_275, "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69", "Best accuracy, every language"),
];

/// The model called `id`.
pub fn find(id: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_model_has_a_file_a_checksum_and_the_default_exists() {
        for model in MODELS {
            assert_eq!(model.file, format!("ggml-{}.bin", model.id));
            assert_eq!(model.sha256.len(), 64, "{}", model.id);
            assert!(model.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "{}", model.id);
            assert_eq!(model.english_only, model.id.ends_with(".en"), "{}", model.id);
        }
        assert!(find(DEFAULT_MODEL).is_some());
        assert!(MODELS.windows(2).all(|w| w[0].id != w[1].id));
    }
}
