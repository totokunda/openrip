//! Fonts for the app's text: the faces a client brings (the app's bundled web fonts) and the
//! fonts installed on the system, by family name.

use openrip_render::fonts;

pub use openrip_render::fonts::{FontFace, FontFamily};

/// Draw text in these faces from now on: each by its family, weight and slant, read from its
/// `source` through the asset seam (`openrip_platform::assets`) when text first uses it. The
/// app registers its bundled web fonts (WOFF2, one file per script) so the engine draws what
/// its font menu shows. A face registered again from the same source replaces the old one.
pub fn register_fonts(faces: Vec<FontFace>) {
    fonts::register(faces);
}

/// A face as CSS describes it (`@font-face`): `unicode_range` is its `unicode-range` text, if
/// any.
pub fn font_face(family: &str, weight: u16, italic: bool, source: &str, unicode_range: Option<&str>) -> FontFace {
    FontFace {
        family: family.trim().trim_matches(|c| c == '"' || c == '\'').to_string(),
        weight: weight.clamp(1, 1000),
        italic,
        stretch: 5,
        source: source.to_string(),
        index: 0,
        ranges: unicode_range.map(fonts::parse_unicode_range).unwrap_or_default(),
    }
}

/// The families text can be drawn in: the registered ones, then the installed ones, each by
/// name. The first call reads the system's font folders (tens of milliseconds).
pub fn font_families() -> Vec<FontFamily> {
    fonts::families()
}
