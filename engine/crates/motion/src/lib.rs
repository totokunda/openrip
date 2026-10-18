//! Classic (non-ML) motion estimation, shared by the editor's motion tools.
//!
//! - [`image`]: grey pictures, gradients and Gaussian pyramids.
//! - [`features`]: corners worth tracking (Shi–Tomasi).
//! - [`klt`]: pyramidal Lucas–Kanade point tracking.
//! - [`fit`]: least-squares and RANSAC fits of similarity and affine motions.
//! - [`region`]: a region followed through a video (position, scale and rotation, with lost
//!   tracking reported): the Tracking tab and Track mask.
//! - [`flow`]: dense optical flow and motion-compensated interpolation on the CPU, the
//!   reference for the compositor's GPU version (Smooth slow-mo and Optical flow).
//!
//! Plain Rust with no dependencies and no platform code, so it runs wherever the engine does
//! (desktop, mobile, the web). Coordinates are pixels with y down; angles are radians,
//! clockwise on screen.

pub mod features;
pub mod fit;
pub mod flow;
pub mod image;
pub mod klt;
pub mod region;
pub mod testing;

pub use features::{good_features, Corner, CornerOptions};
pub use fit::{fit_affine, fit_similarity, ransac_affine, ransac_similarity, Affine, Ransac, Similarity};
pub use flow::{dense_flow, Flow, FlowOptions};
pub use image::{Gray, Level, Pyramid};
pub use klt::{Klt, Tracked};
pub use region::{Region, RegionTracker, Step, TrackError, TrackerOptions};
