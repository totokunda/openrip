//! Picture analysis by classic methods (no machine learning), over pixels in memory, for the
//! editor's one-click tools (docs/plan/capcut-ui-spec.md §6.31):
//!
//! - [`scenes`]: shot changes in a run of frames (Split scenes): hard cuts from
//!   motion-compensated histogram, edge and pixel differences against an adaptive threshold;
//!   dissolves and fades from differences across wider spans that a blend of their ends
//!   explains; fades through black or white from runs of blank frames.
//! - [`stats`]: a clip's colour statistics from frames sampled across it.
//! - [`auto`]: Adjust ▸ Auto adjust: the Basic sliders set from those statistics (levels,
//!   brightness, contrast, saturation, white balance), solved against the sliders' own maths.
//! - [`matching`]: Adjust ▸ Color match: a clip's colours moved to a reference's (Reinhard's
//!   mean and spread transfer, in Oklab), as a 3D lookup table the compositor applies.
//!
//! Frames come from whoever decodes them (`openrip-playback` scans a file); nothing here
//! reads files, uses threads or knows the platform.

pub mod auto;
pub mod colour;
pub mod matching;
pub mod scenes;
pub mod stats;

pub use auto::{auto_adjust, Sliders};
pub use matching::Transfer;
pub use scenes::{CutKind, SceneCut, SceneDetector, SceneOptions};
pub use stats::{ColorSample, ColorStats, Moments};
