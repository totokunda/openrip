//! CapCut drafts as app projects.

use std::path::Path;
use std::time::Instant;

use openrip_playback::PreviewEngine;

use crate::Result;

#[derive(Clone, Debug)]
pub struct AppProjectFromDraft {
    /// The app's project document (JSON), without the app's own `meta`.
    pub json: String,
    /// The draft's name.
    pub name: String,
    /// Media the draft uses that isn't on this machine.
    pub missing_media: Vec<String>,
    /// What the importer couldn't map, one line each.
    pub notes: Vec<String>,
}

/// The CapCut draft in folder `dir` as an app project: the app's own clips, each carrying
/// its segment so the engine draws it as CapCut did. Blocks: call it off the UI thread.
pub fn capcut_to_app(dir: &Path) -> Result<AppProjectFromDraft> {
    let t0 = Instant::now();
    let imported = openrip_capcut::import_draft_dir(dir)?;
    let project = imported.project;
    let t1 = Instant::now();
    // The engine lays out each text, so the app's box around it fits.
    let mut engine = PreviewEngine::new(project.clone())?;
    let t2 = Instant::now();
    let doc = openrip_v1::to_app_project(&project, &mut |seg| engine.text_block(&seg.id));
    if std::env::var_os("OPENRIP_TRACE").is_some() {
        eprintln!("[capcut] draft {:.0} ms, engine {:.0} ms, convert {:.0} ms", (t1 - t0).as_secs_f64() * 1e3, (t2 - t1).as_secs_f64() * 1e3, t2.elapsed().as_secs_f64() * 1e3);
    }
    let r = &imported.report;
    let mut notes: Vec<String> = r.foreign.iter().map(|(k, n)| format!("{k}: {n} kept for the engine, not drawn yet")).collect();
    notes.extend(r.warnings.iter().cloned());
    Ok(AppProjectFromDraft { json: doc.to_string(), name: project.name.clone(), missing_media: r.missing_media.clone(), notes })
}
