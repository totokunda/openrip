//! Background work: how the engine starts its long-running workers (a frame server per
//! source, the render-ahead preview, decoder prefetch, scrub workers, the audio mixer).
//!
//! Each is a closure that runs until the engine tells it to stop, blocking on locks and
//! condition variables in between, and is joined when its owner is dropped. [`Threads`]
//! gives each an OS thread, as desktop and mobile want. A web build has no threads of its
//! own: it installs a [`Spawner`] that runs the work on Web Workers (wasm threads), and
//! until it does, [`spawn`] fails and the engine reports that instead of starting.

use std::any::Any;
use std::io;
use std::sync::{Arc, RwLock};

/// A running piece of background work.
pub struct Task {
    join: Option<Box<dyn FnOnce() -> std::thread::Result<()> + Send + Sync>>,
}

impl Task {
    /// A task for work the spawner runs its own way: `join` waits for it to finish.
    pub fn new(join: impl FnOnce() -> std::thread::Result<()> + Send + Sync + 'static) -> Task {
        Task { join: Some(Box::new(join)) }
    }

    /// A task with nothing left to wait for.
    pub fn done() -> Task {
        Task { join: None }
    }

    /// Wait for the work to finish; `Err` (with the payload) if it panicked.
    pub fn join(mut self) -> Result<(), Box<dyn Any + Send + 'static>> {
        match self.join.take() {
            Some(join) => join(),
            None => Ok(()),
        }
    }
}

/// Starts background work.
pub trait Spawner: Send + Sync {
    /// Start `work`; `name` is for debuggers and traces.
    fn spawn(&self, name: String, work: Box<dyn FnOnce() + Send>) -> io::Result<Task>;
}

/// An OS thread per task.
#[derive(Copy, Clone, Debug, Default)]
pub struct Threads;

impl Spawner for Threads {
    fn spawn(&self, name: String, work: Box<dyn FnOnce() + Send>) -> io::Result<Task> {
        let handle = std::thread::Builder::new().name(name).spawn(work)?;
        Ok(Task::new(move || handle.join()))
    }
}

static SPAWNER: RwLock<Option<Arc<dyn Spawner>>> = RwLock::new(None);

/// Start the engine's background work through `spawner` from now on.
pub fn set_spawner(spawner: Arc<dyn Spawner>) {
    *SPAWNER.write().unwrap() = Some(spawner);
}

/// Start `work` in the background with the spawner in use: the client's, or [`Threads`].
pub fn spawn(name: impl Into<String>, work: impl FnOnce() + Send + 'static) -> io::Result<Task> {
    let spawner = SPAWNER.read().unwrap().clone();
    match spawner {
        Some(s) => s.spawn(name.into(), Box::new(work)),
        None => Threads.spawn(name.into(), Box::new(work)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_run_and_join() {
        let (tx, rx) = std::sync::mpsc::channel();
        let t = spawn("test-task", move || tx.send(std::thread::current().name().map(str::to_string)).unwrap()).unwrap();
        t.join().unwrap();
        assert_eq!(rx.recv().unwrap().as_deref(), Some("test-task"));
        assert!(spawn("panics", || panic!("on purpose")).unwrap().join().is_err());
        assert!(Task::done().join().is_ok());
    }
}
