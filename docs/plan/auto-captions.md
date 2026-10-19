# Auto captions and Auto lyrics

Status 2026-10-19. Speech to captions with a local model (the owner's amendment to the no-AI rule: local models are allowed for captions and transcripts; see ROADMAP.md and `capcut-ui-spec.md` §6.11 and §6.31). Nothing leaves the device but the model download, and there are no accounts.

## Pieces

- `engine/crates/speech` (`openrip-speech`): the portable part (transcript to captions: lines split by length, fillers left out, keywords flagged, each word with its timing; word times tightened against the sound), the model catalog (ggml Whisper files from `ggerganov/whisper.cpp` on Hugging Face, sizes and SHA-256), and the `Recognizer` seam. The built-in recognizer is whisper.cpp through `whisper-rs`, behind the `whisper` feature (Metal on Apple). Without it the crate still builds for every target (`check-targets.sh` lists it with the pure crates, and checks it with `whisper` on the host).
- `openrip-core` decodes a clip's sound (through the audio decode seam) or the timeline's mix (the mixer) to 16 kHz mono; the addon runs it on a worker thread with progress and cancel (`transcribeSpeech`, `speechProgress`, `cancelSpeech`).
- The main process's `SpeechModule` downloads models into `<userData>/speech-models/` (a `.part` file, renamed once its size and SHA-256 match), lists and deletes them. `OPENRIP_SPEECH_MODELS` and `OPENRIP_SPEECH_DOWNLOAD_BASE` redirect both for tests.
- The renderer's `lib/autocaptions.ts` and `AutoCaptionsMenu`: the panel, one undo step per Generate, Generate again replaces the track the last one made.
- Captions are text clips with `captionWords` (each word's character range and clip-local times, keywords flagged) and `captionStyle` / `captionColor`. v1 turns them into the text material's spoken words; the engine's `playback/src/caption.rs` draws OpenRip's four word-by-word styles (`orip_highlight`, `orip_karaoke`, `orip_pop`, `orip_boxed`, each `name:#colour`) besides CapCut's two. `render/src/text.rs` has per-word boxes for `orip_boxed`.

## Default model

`small` (multilingual, 488 MB): the smallest model that gets everyday words right (`base` heard "blog" for "vlog" on the test clip) and has auto-detect and the language menu. On an M2 Max (Metal) it runs about 20 to 30 times faster than real time; `base` (148 MB) and `tiny` (78 MB) are in the list, with the medium and large-v3-turbo models for harder audio.

## Timing

DTW alignment over Whisper's cross-attention gives where each word is done by; a word's start is then moved to where its sound begins, judged by the audio's short-time energy (`speech/src/align.rs`). Against macOS `say` fixtures (`engine/scripts/speech-fixture.py`) the default model's word starts are within 10 to 25 ms on average.

## Licences

Whisper's weights are OpenAI's, MIT licensed; whisper.cpp and ggml are MIT. Both notices are in the Third-party copyright list (`apps/app/scripts/third-party-notices.mjs`). The models are downloaded, not shipped in the app.

## Not done

Bilingual captions, AI emojis and AI packaging (out of scope for now). The recognizer is desktop only: iOS, Android and the web take a platform recognizer through the `Recognizer` seam (`docs/plan/portability.md`).
