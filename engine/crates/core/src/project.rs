//! Projects in, from any of the formats the engine reads.

use std::path::Path;

use openrip_model::Project;

use crate::Result;

/// Where a project came from.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// A CapCut draft (its folder, or its `draft_info.json`).
    CapCut,
    /// An OpenRip project document.
    OpenRip,
    /// A project saved by the TypeScript app (format v1).
    V1,
}

impl Source {
    /// "capcut", "openrip" or "v1".
    pub fn as_str(self) -> &'static str {
        match self {
            Source::CapCut => "capcut",
            Source::OpenRip => "openrip",
            Source::V1 => "v1",
        }
    }
}

/// An open project's outline, for the client.
#[derive(Clone, Debug)]
pub struct ProjectInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_us: i64,
    pub tracks: u32,
    pub segments: u32,
    pub source: Source,
    /// After [`crate::Session::update`]: where CapCut texts whose words or style the edit
    /// changed are now laid out, so the app's box around each can follow.
    pub text_blocks: Vec<TextBlock>,
}

/// A text segment's block of lines on the canvas, in canvas pixels, before its rotation.
#[derive(Clone, Debug)]
pub struct TextBlock {
    pub segment: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl ProjectInfo {
    pub(crate) fn of(project: &Project, source: Source) -> ProjectInfo {
        ProjectInfo {
            name: project.name.clone(),
            width: project.canvas.width,
            height: project.canvas.height,
            fps: project.fps.as_f64(),
            duration_us: project.duration().0,
            tracks: project.tracks.len() as u32,
            segments: project.segment_count() as u32,
            source,
            text_blocks: Vec::new(),
        }
    }
}

/// Load a project: a CapCut draft folder, an OpenRip project JSON, or a v1 project file.
pub fn load_project(path: &Path) -> Result<(Project, Source)> {
    if path.is_dir() {
        return Ok((openrip_capcut::import_draft_dir(path)?.project, Source::CapCut));
    }
    let text = std::fs::read_to_string(path)?;
    if let Ok(p) = serde_json::from_str::<Project>(&text) {
        return Ok((p, Source::OpenRip));
    }
    Ok((openrip_v1::import_v1_file(path)?.project, Source::V1))
}

/// A project from JSON text: an OpenRip project, a v1 project (the app's own format) or a
/// CapCut draft's `draft_info.json`.
pub fn parse_project_json(json: &str) -> Result<(Project, Source)> {
    if let Ok(p) = serde_json::from_str::<Project>(json) {
        return Ok((p, Source::OpenRip));
    }
    let doc: serde_json::Value = serde_json::from_str(json)?;
    if doc.get("tracks").is_some() && doc.get("materials").is_some() {
        return Ok((openrip_capcut::import_draft_json(&doc, "draft")?.project, Source::CapCut));
    }
    Ok((openrip_v1::import_v1_json(&doc)?.project, Source::V1))
}
