//! The built-in recognizer: whisper.cpp through `whisper-rs` (MIT), on Metal where there is
//! one. Word times come from DTW alignment over the model's cross-attention (whisper.cpp's
//! `dtw` presets) where the model has a preset, else from its token timestamps.

use std::path::PathBuf;
use std::sync::Arc;

use whisper_rs::{DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::backend::{Control, Recognizer, Request, SpeechError};
use crate::transcript::{words_from_tokens, Segment, Token, Transcript};

pub struct Whisper;

fn preset(file: &str) -> Option<DtwModelPreset> {
    let id = file.strip_prefix("ggml-")?.strip_suffix(".bin")?;
    let id = id.strip_suffix("-q5_0").or_else(|| id.strip_suffix("-q5_1")).or_else(|| id.strip_suffix("-q8_0")).unwrap_or(id);
    Some(match id {
        "tiny" => DtwModelPreset::Tiny,
        "tiny.en" => DtwModelPreset::TinyEn,
        "base" => DtwModelPreset::Base,
        "base.en" => DtwModelPreset::BaseEn,
        "small" => DtwModelPreset::Small,
        "small.en" => DtwModelPreset::SmallEn,
        "medium" => DtwModelPreset::Medium,
        "medium.en" => DtwModelPreset::MediumEn,
        "large-v3" => DtwModelPreset::LargeV3,
        "large-v3-turbo" => DtwModelPreset::LargeV3Turbo,
        _ => return None,
    })
}

/// `OPENRIP_WHISPER_TIMING=token` turns DTW off (to compare the two).
fn dtw_wanted() -> bool {
    std::env::var("OPENRIP_WHISPER_TIMING").map_or(true, |v| v != "token")
}

/// Load the model. Not kept between requests: whisper.cpp's Metal device asserts at process
/// exit if a context is still alive then (a static would be), which in the desktop app would
/// be a crash on quit. Loading costs a fraction of a second for the small models.
fn context(model: &PathBuf) -> Result<(WhisperContext, bool), SpeechError> {
    if !model.is_file() {
        return Err(SpeechError::Model(format!("the speech model isn't downloaded: {}", model.display())));
    }
    let file = model.file_name().and_then(|f| f.to_str()).unwrap_or("");
    let model_preset = if dtw_wanted() { preset(file) } else { None };
    let dtw = model_preset.is_some();
    let mut params = WhisperContextParameters::default();
    if let Some(model_preset) = model_preset {
        // DTW reads the attention weights, which flash attention doesn't keep.
        params.flash_attn(false).dtw_parameters(DtwParameters { mode: DtwMode::ModelPreset { model_preset }, dtw_mem_size: 128 * 1024 * 1024 });
    }
    let path = model.to_str().ok_or_else(|| SpeechError::Model("the model's path isn't text".into()))?;
    let ctx = WhisperContext::new_with_params(path, params).map_err(|e| SpeechError::Model(format!("couldn't load {file}: {e}")))?;
    Ok((ctx, dtw))
}

/// whisper.cpp and ggml print their progress to stderr; routed to the `log` crate (where
/// nothing listens) instead, unless `OPENRIP_WHISPER_LOG=1`.
fn quiet() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if std::env::var_os("OPENRIP_WHISPER_LOG").is_none() {
            whisper_rs::install_logging_hooks();
        }
    });
}

impl Recognizer for Whisper {
    fn transcribe(&self, request: &Request, control: &Arc<Control>) -> Result<Option<Transcript>, SpeechError> {
        quiet();
        let (ctx, dtw) = context(&request.model)?;
        let english_only = request.model.file_name().and_then(|f| f.to_str()).is_some_and(|f| f.contains(".en"));
        let mut state = ctx.create_state().map_err(|e| SpeechError::Failed(e.to_string()))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let language = if english_only { Some("en".to_string()) } else { request.language.clone().filter(|l| !l.is_empty() && l != "auto") };
        params.set_language(Some(language.as_deref().unwrap_or("auto")));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(true);
        params.set_suppress_nst(true);
        params.set_n_threads(std::thread::available_parallelism().map_or(4, |n| n.get().min(8)) as i32);
        let progress = control.clone();
        params.set_progress_callback_safe(move |p: i32| progress.set_percent(p.clamp(0, 99) as u32));
        let cancel = control.clone();
        // whisper-rs 0.16's `set_abort_callback_safe` hands its trampoline a pointer to a boxed
        // trait object but reads it back as the closure's own type (progress's does it right
        // by being given the boxed type), so the closure goes in already boxed.
        let abort: Box<dyn FnMut() -> bool> = Box::new(move || cancel.cancelled());
        params.set_abort_callback_safe(abort);
        let result = state.full(params, request.audio);
        if control.cancelled() {
            return Err(SpeechError::Cancelled);
        }
        result.map_err(|e| SpeechError::Failed(e.to_string()))?;
        let detected = language.unwrap_or_else(|| whisper_rs::get_lang_str(state.full_lang_id_from_state()).unwrap_or("en").to_string());
        let eot = ctx.token_eot();
        let cs = |t: i64| t * 10_000;
        let mut segments = Vec::new();
        for seg in state.as_iter() {
            let (seg_start, seg_end) = (cs(seg.start_timestamp()), cs(seg.end_timestamp()));
            // The text tokens. DTW gives the time a token is *done* by (measured against
            // words said alone), so a token runs from where the one before was done, the first
            // from the segment's start; the token timestamps give a start and an end.
            let mut tokens: Vec<Token> = Vec::new();
            let mut done = seg_start;
            for k in 0..seg.n_tokens() {
                let Some(token) = seg.get_token(k) else { continue };
                if token.token_id() >= eot {
                    continue;
                }
                let data = token.token_data();
                let text = token.to_str_lossy().map_err(|e| SpeechError::Failed(e.to_string()))?.into_owned();
                if std::env::var_os("OPENRIP_WHISPER_DEBUG").is_some() {
                    eprintln!("token {text:?} t0 {} t1 {} dtw {}", data.t0, data.t1, data.t_dtw);
                }
                let (start, end) = if dtw && data.t_dtw >= 0 {
                    let end = cs(data.t_dtw).clamp(done, seg_end.max(done));
                    (done, end)
                } else {
                    let start = cs(data.t0).clamp(seg_start, seg_end.max(seg_start));
                    (start, cs(data.t1).clamp(start, seg_end.max(start)))
                };
                done = end;
                tokens.push(Token { text, start_us: start, end_us: end });
            }
            let words = words_from_tokens(&tokens);
            if words.is_empty() {
                continue;
            }
            // A segment the model thinks is no speech is a hallucination over silence.
            if seg.no_speech_probability() > 0.8 {
                continue;
            }
            segments.push(Segment { start_us: words[0].start_us, end_us: words[words.len() - 1].end_us, words });
        }
        Ok(Some(Transcript { language: detected, segments }))
    }
}
