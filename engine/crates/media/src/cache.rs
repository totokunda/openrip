//! Recently decoded frames, so stepping or playing backward doesn't re-decode a GOP for
//! every frame.
//!
//! A cached frame answers a request for time `t` only when it is provably the frame shown
//! at `t`: it starts at or before `t`, and the frame that follows it in presentation order
//! is known (it came out of the decoder right after it) and starts after `t`.

use std::collections::{BTreeMap, BTreeSet};

use crate::{MediaError, Micros, VideoFrame};

struct Entry {
    frame: VideoFrame,
    /// Start of the next frame in presentation order, if it was decoded right after this one.
    next: Option<i64>,
    bytes: usize,
}

pub(crate) struct FrameCache {
    frames: BTreeMap<i64, Entry>,
    bytes: usize,
    budget: usize,
    /// The last frame inserted, if the next output can be linked to it.
    last: Option<i64>,
    /// Pictures decoded without output (reference-only) since the last reset: a link may not
    /// skip over one of them.
    hidden: BTreeSet<i64>,
}

impl FrameCache {
    pub(crate) fn new(budget: usize) -> Self {
        FrameCache { frames: BTreeMap::new(), bytes: 0, budget, last: None, hidden: BTreeSet::new() }
    }

    /// The frame shown at `t`, if the cache knows it.
    pub(crate) fn get(&self, t: Micros) -> Option<Result<VideoFrame, MediaError>> {
        let (_, e) = self.frames.range(..=t.0).next_back()?;
        e.next.is_some_and(|n| t.0 < n).then(|| e.frame.try_clone())
    }

    /// A picture at `time` was decoded but not output.
    pub(crate) fn hide(&mut self, time: Micros) {
        self.hidden.insert(time.0);
    }

    /// The decoder was reset (seek): the next output follows nothing we know.
    pub(crate) fn break_chain(&mut self) {
        self.last = None;
        self.hidden.clear();
    }

    /// Record a frame that just came out of the decoder; `near` is the time being requested,
    /// used to evict the frames farthest from it.
    pub(crate) fn insert(&mut self, frame: &VideoFrame, bytes: usize, near: Micros) -> Result<(), MediaError> {
        if self.budget == 0 || bytes > self.budget {
            return Ok(());
        }
        let t = frame.time.0;
        if let Some(prev) = self.last.take() {
            if prev < t && self.hidden.range(prev + 1..t).next().is_none() {
                if let Some(e) = self.frames.get_mut(&prev) {
                    e.next = Some(t);
                }
            }
        }
        self.last = Some(t);
        self.hidden = self.hidden.split_off(&t);
        if let Some(old) = self.frames.insert(t, Entry { frame: frame.try_clone()?, next: None, bytes }) {
            self.bytes -= old.bytes;
        }
        self.bytes += bytes;
        while self.bytes > self.budget {
            let first = *self.frames.keys().next().unwrap();
            let last = *self.frames.keys().next_back().unwrap();
            let victim = if (near.0 - first).abs() >= (last - near.0).abs() { first } else { last };
            if victim == t && self.frames.len() == 1 {
                break;
            }
            let e = self.frames.remove(&victim).unwrap();
            self.bytes -= e.bytes;
            // The frame before the victim no longer has a known successor in the cache, but
            // its `next` time is still true, so it stays valid.
        }
        Ok(())
    }
}
