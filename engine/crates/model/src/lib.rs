//! OpenRip's project model. Its shape mirrors CapCut's draft format (tracks →
//! segments → materials, microsecond time, per-property keyframes) so CapCut
//! projects import as a translation rather than a reinterpretation.

pub mod animated;
pub mod edit;
pub mod fx;
pub mod keyed;
pub mod material;
pub mod project;
pub mod speed;
pub mod time;

pub use animated::{capcut_curve, capcut_solve, sample_keys, split_keys, Animated, Easing, Handle, Keyframe, Lerp, Rgba, Vec2};
pub use edit::{ChangeSet, Document, Edge, Edit, EditError, Op, SegmentChange};
pub use keyed::{Param, ParamKeys};
pub use material::*;
pub use project::*;
pub use speed::Remap;
pub use time::{FrameRate, Micros, TimeRange};
