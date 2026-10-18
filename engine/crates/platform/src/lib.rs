//! The engine's view of the platform it runs on, as two small seams with a portable default
//! behind each:
//!
//! - [`assets`]: where media, bundles, fonts and caches are read from (and caches written
//!   to). Files by path by default; a client can resolve its own names (handles, URLs,
//!   blobs in memory).
//! - [`tasks`]: how the engine's background work starts (frame servers, the render-ahead
//!   preview, prefetch, scrub workers, the audio mixer). OS threads by default; a web build
//!   can hand them to its own executor.
//!
//! Both are process-wide and set once, early, by the client (the binding): the engine calls
//! them from wherever it is, without the setting threaded through every call. Pure std, so
//! every target builds it.

pub mod assets;
pub mod tasks;
