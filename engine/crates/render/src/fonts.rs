//! The fonts text is drawn in, by family name: the faces a client registers (the app's
//! bundled web fonts, which its font menu shows) and the fonts installed on the system.
//!
//! A client registers each face with [`register`]: its family, weight and slant, the asset
//! that holds it (read through `openrip_platform::assets`, so a path, or a name a client's
//! resolver serves, e.g. bytes in a `Memory`) and the characters it's for (a web font comes
//! as one file per script, each with its CSS `unicode-range`). The system's fonts are found
//! once, the first time they're needed, by reading only the name and style tables of each
//! font file in the platform's font folders ([`system_faces`]).
//!
//! [`resolve`] picks the faces for a family at a weight and slant as a browser does (CSS
//! font matching): registered faces before installed ones of the same name, the nearest
//! weight by the CSS rule, and bold or italic left to synthesise when the family has no such
//! face. A web font's files for the chosen weight and slant come back together, the one for
//! Latin first, to draw with [`crate::text::Font::with_fallbacks`]. [`families`] lists what
//! can be drawn, for a font menu.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};

use openrip_platform::assets;

/// One face of a family: what it is and where its file is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FontFace {
    pub family: String,
    /// CSS weight, 1–1000 (400 regular, 700 bold).
    pub weight: u16,
    pub italic: bool,
    /// Its width as OpenType's width classes count it, 1–9 (5 normal, lower condensed).
    pub stretch: u16,
    /// The asset holding it (a file path today), read through `openrip_platform::assets`.
    pub source: String,
    /// The face's index in a collection (`.ttc`); 0 for a single font.
    pub index: u32,
    /// The characters it's meant for, inclusive ranges of code points as CSS `unicode-range`
    /// gives them; empty for all.
    pub ranges: Vec<(u32, u32)>,
}

impl FontFace {
    fn covers(&self, c: u32) -> bool {
        self.ranges.is_empty() || self.ranges.iter().any(|&(a, b)| (a..=b).contains(&c))
    }
}

/// A family as a font menu lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FontFamily {
    pub name: String,
    /// The weights it has faces for, ascending.
    pub weights: Vec<u16>,
    /// Whether it has an italic face.
    pub italic: bool,
    /// Registered by the client (the app's bundled fonts) rather than installed.
    pub registered: bool,
}

/// The faces to draw a family in at a weight and slant: the main face first, then the ones
/// for characters it doesn't have (a web font's other scripts). Bold or italic the faces
/// don't have are to be synthesised.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub faces: Vec<FontFace>,
    pub synthetic_bold: bool,
    pub synthetic_italic: bool,
}

impl Resolved {
    /// A key naming these faces, for caches.
    pub fn key(&self) -> String {
        self.faces.iter().map(|f| format!("{}#{}", f.source, f.index)).collect::<Vec<_>>().join("|")
    }
}

static REGISTERED: RwLock<Vec<FontFace>> = RwLock::new(Vec::new());
static SYSTEM: OnceLock<Vec<FontFace>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Add faces to draw text with. A face already registered from the same source and index is
/// replaced.
pub fn register(faces: impl IntoIterator<Item = FontFace>) {
    let mut all = REGISTERED.write().unwrap();
    for face in faces {
        all.retain(|f| (f.source.as_str(), f.index) != (face.source.as_str(), face.index));
        all.push(face);
    }
    GENERATION.fetch_add(1, Ordering::Relaxed);
}

/// A number that changes whenever faces are registered, so a cache of what [`resolve`]
/// returned knows when to ask again.
pub fn generation() -> u64 {
    GENERATION.load(Ordering::Relaxed)
}

/// Every face registered so far, in order.
pub fn registered() -> Vec<FontFace> {
    REGISTERED.read().unwrap().clone()
}

/// The fonts installed on the system, read once (see [`font_folders`]).
pub fn system_faces() -> &'static [FontFace] {
    SYSTEM.get_or_init(|| {
        let mut faces = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for dir in font_folders() {
            scan(&dir, 0, &mut seen, &mut faces);
        }
        faces
    })
}

/// Every family text can be drawn in: the registered ones, then the installed ones not
/// registered under the same name, each sorted by name.
pub fn families() -> Vec<FontFamily> {
    let mut out: Vec<FontFamily> = Vec::new();
    let add = |faces: &[FontFace], registered: bool, out: &mut Vec<FontFamily>| {
        let start = out.len();
        for f in faces {
            if out[..start].iter().any(|g| g.name.eq_ignore_ascii_case(&f.family)) {
                continue;
            }
            match out[start..].iter_mut().find(|g| g.name.eq_ignore_ascii_case(&f.family)) {
                Some(g) => {
                    if !g.weights.contains(&f.weight) {
                        g.weights.push(f.weight);
                    }
                    g.italic |= f.italic;
                }
                None => out.push(FontFamily { name: f.family.clone(), weights: vec![f.weight], italic: f.italic, registered }),
            }
        }
        out[start..].iter_mut().for_each(|g| g.weights.sort_unstable());
        out[start..].sort_by_key(|g| g.name.to_lowercase());
    };
    add(&registered(), true, &mut out);
    add(system_faces(), false, &mut out);
    out
}

/// The faces for `family` (any letter case) at CSS `weight` and slant, registered ones before
/// installed ones; `None` if neither has the family.
pub fn resolve(family: &str, weight: u16, italic: bool) -> Option<Resolved> {
    resolve_from(family, weight, italic, true)
}

/// [`resolve`] among the registered faces only.
pub fn resolve_registered(family: &str, weight: u16, italic: bool) -> Option<Resolved> {
    resolve_from(family, weight, italic, false)
}

fn resolve_from(family: &str, weight: u16, italic: bool, installed: bool) -> Option<Resolved> {
    let family = family.trim();
    if family.is_empty() {
        return None;
    }
    let registered = registered();
    let of = |faces: &[FontFace]| faces.iter().filter(|f| f.family.eq_ignore_ascii_case(family)).cloned().collect::<Vec<_>>();
    let candidates = Some(of(&registered)).filter(|c| !c.is_empty()).or_else(|| installed.then(|| of(system_faces())).filter(|c| !c.is_empty()))?;
    resolve_in(&candidates, weight, italic)
}

/// [`resolve`] among one family's faces.
fn resolve_in(candidates: &[FontFace], weight: u16, italic: bool) -> Option<Resolved> {
    // The slant first (an italic face if there is one when italic is asked for, else upright),
    // then the weight within it.
    let slant = if candidates.iter().any(|f| f.italic == italic) { italic } else { !italic };
    let mut weights: Vec<u16> = candidates.iter().filter(|f| f.italic == slant).map(|f| f.weight).collect();
    weights.sort_unstable();
    weights.dedup();
    let chosen = nearest_weight(&weights, weight)?;
    let mut faces: Vec<FontFace> = candidates.iter().filter(|f| f.italic == slant && f.weight == chosen).cloned().collect();
    // The normal width, or the nearest to it (narrower first): a family can have condensed
    // faces of the same weight.
    let off = |f: &FontFace| (f.stretch.abs_diff(5), f.stretch > 5);
    let width = faces.iter().map(off).min()?;
    faces.retain(|f| off(f) == width);
    if faces.iter().all(|f| f.ranges.is_empty()) {
        // An installed font: one face draws it all.
        faces.truncate(1);
    } else if let Some(i) = faces.iter().position(|f| f.covers('A' as u32)) {
        // A web font's files: the one for Latin text first; the others draw what it doesn't have.
        let main = faces.remove(i);
        faces.insert(0, main);
    }
    Some(Resolved { faces, synthetic_bold: weight >= 600 && chosen < 600, synthetic_italic: italic && !slant })
}

/// CSS's choice of weight among `available` (ascending) for `wanted` (CSS Fonts 4, font
/// matching): 400–500 look up to 500, then down, then up; below that down then up; above,
/// up then down.
fn nearest_weight(available: &[u16], wanted: u16) -> Option<u16> {
    if available.contains(&wanted) {
        return Some(wanted);
    }
    let below = || available.iter().rev().find(|&&w| w < wanted).copied();
    let above = || available.iter().find(|&&w| w > wanted).copied();
    if (400..=500).contains(&wanted) {
        available.iter().find(|&&w| w > wanted && w <= 500).copied().or_else(below).or_else(above)
    } else if wanted < 400 {
        below().or_else(above)
    } else {
        above().or_else(below)
    }
}

/// CSS `unicode-range` as code point ranges: `U+0000-00FF, U+0131, U+4??` (a `?` stands for
/// any hex digit). Parts that don't parse are left out.
pub fn parse_unicode_range(css: &str) -> Vec<(u32, u32)> {
    css.split(',')
        .filter_map(|part| {
            let part = part.trim();
            let hex = part.strip_prefix("U+").or_else(|| part.strip_prefix("u+"))?;
            let num = |s: &str| u32::from_str_radix(s, 16).ok();
            match hex.split_once('-') {
                Some((a, b)) => Some((num(a)?, num(b)?)),
                None if hex.contains('?') => Some((num(&hex.replace('?', "0"))?, num(&hex.replace('?', "F"))?)),
                None => num(hex).map(|c| (c, c)),
            }
        })
        .collect()
}

/// Where the platform keeps installed fonts. The system's folders, then the user's.
pub fn font_folders() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts"].map(PathBuf::from));
        dirs.extend(home.map(|h| h.join("Library/Fonts")));
    } else if cfg!(target_os = "windows") {
        dirs.push(PathBuf::from(std::env::var_os("WINDIR").map_or("C:\\Windows".into(), PathBuf::from).join("Fonts")));
        dirs.extend(std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Microsoft\\Windows\\Fonts")));
    } else if cfg!(target_os = "android") {
        dirs.push(PathBuf::from("/system/fonts"));
    } else if cfg!(all(unix, not(target_vendor = "apple"))) {
        dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        dirs.extend(home.iter().flat_map(|h| [h.join(".local/share/fonts"), h.join(".fonts")]));
    }
    // iOS and the web have no folders to read: their clients register fonts.
    dirs
}

/// Font files in `dir` and the folders in it (to a few levels), each file's faces added.
fn scan(dir: &Path, depth: u32, seen: &mut std::collections::HashSet<PathBuf>, out: &mut Vec<FontFace>) {
    let Ok(mut entries) = assets::list(dir) else { return };
    entries.sort();
    for path in entries {
        if !seen.insert(path.clone()) {
            continue;
        }
        if assets::is_dir(&path) {
            if depth < 3 {
                scan(&path, depth + 1, seen, out);
            }
            continue;
        }
        let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("ttf" | "otf" | "ttc" | "otc")) {
            continue;
        }
        let Ok(mut file) = assets::open(&path) else { continue };
        for (index, info) in read_faces(&mut file).into_iter().enumerate() {
            // Names starting with a dot are the system's private UI fonts.
            if info.family.is_empty() || info.family.starts_with('.') {
                continue;
            }
            out.push(FontFace { family: info.family, weight: info.weight, italic: info.italic, stretch: info.stretch, source: path.to_string_lossy().into_owned(), index: index as u32, ranges: Vec::new() });
        }
    }
}

/// What a face's tables say it is.
#[derive(Debug, PartialEq)]
struct FaceInfo {
    family: String,
    weight: u16,
    stretch: u16,
    italic: bool,
}

/// The faces in a font file (one, or each of a collection's), from their `name`, `OS/2` and
/// `head` tables, reading only those. A face it can't read is left out.
fn read_faces(file: &mut (impl Read + Seek + ?Sized)) -> Vec<FaceInfo> {
    let Some(header) = bytes_at(file, 0, 12) else { return Vec::new() };
    let offsets: Vec<u64> = if header.starts_with(b"ttcf") {
        let n = u32_in(&header, 8).unwrap_or(0).min(256) as usize;
        bytes_at(file, 12, 4 * n).map_or(Vec::new(), |b| (0..n).filter_map(|i| u32_in(&b, 4 * i).map(u64::from)).collect())
    } else {
        vec![0]
    };
    offsets.into_iter().filter_map(|at| read_face(file, at)).collect()
}

fn read_face(file: &mut (impl Read + Seek + ?Sized), at: u64) -> Option<FaceInfo> {
    let tables = u16_in(&bytes_at(file, at + 4, 2)?, 0)?.min(512) as usize;
    let dir = bytes_at(file, at + 12, 16 * tables)?;
    let find = |want: &[u8; 4]| -> Option<(u64, usize)> {
        (0..tables).find_map(|i| (&dir[16 * i..16 * i + 4] == want).then(|| Some((u32_in(&dir, 16 * i + 8)? as u64, u32_in(&dir, 16 * i + 12)? as usize)))?)
    };
    // Each table whole (up to what's read of it), in one read.
    let (name_at, name_len) = find(b"name")?;
    let name = bytes_at(file, name_at, name_len.min(1 << 20))?;
    let os2 = find(b"OS/2").and_then(|(at, len)| bytes_at(file, at, len.min(64)));
    let head = find(b"head").and_then(|(at, len)| bytes_at(file, at, len.min(54)));
    let family = read_name(&name, 16).or_else(|| read_name(&name, 1))?;
    let weight = match os2.as_deref().and_then(|t| u16_in(t, 4)).unwrap_or(400) {
        // Unset, or on the 1–9 scale some old fonts use.
        0 => 400,
        w @ 1..=9 => w * 100,
        w => w.min(1000),
    };
    let stretch = os2.as_deref().and_then(|t| u16_in(t, 6)).filter(|w| (1..=9).contains(w)).unwrap_or(5);
    let os2_italic = os2.as_deref().and_then(|t| u16_in(t, 62)).map(|sel| sel & (1 | 1 << 9) != 0);
    let head_italic = head.as_deref().and_then(|t| u16_in(t, 44)).map(|style| style & 2 != 0);
    Some(FaceInfo { family, weight, stretch, italic: os2_italic.or(head_italic).unwrap_or(false) })
}

/// Name `id` from a `name` table: the US English Windows (Unicode) string if there is one,
/// else the English Macintosh one, else any Unicode one.
fn read_name(table: &[u8], id: u16) -> Option<String> {
    let count = u16_in(table, 2)?.min(4096) as usize;
    let storage = u16_in(table, 4)? as usize;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let rec = 6 + 12 * i;
        let field = |k: usize| u16_in(table, rec + 2 * k);
        let (Some(platform), Some(encoding), Some(language), Some(name_id), Some(length), Some(offset)) = (field(0), field(1), field(2), field(3), field(4), field(5)) else { break };
        if name_id != id {
            continue;
        }
        let rank = match (platform, encoding, language) {
            (3, 1 | 10, 0x409) => 0,
            (1, 0, 0) => 1,
            (0, _, _) => 2,
            (3, 1 | 10, _) => 3,
            _ => continue,
        };
        if best.as_ref().is_some_and(|(r, _)| *r <= rank) {
            continue;
        }
        let Some(bytes) = table.get(storage + offset as usize..storage + offset as usize + length as usize) else { continue };
        let text = if platform == 1 {
            bytes.iter().map(|&b| b as char).collect()
        } else {
            String::from_utf16_lossy(&bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>())
        };
        let text = text.trim().to_string();
        if !text.is_empty() {
            best = Some((rank, text));
        }
    }
    best.map(|(_, s)| s)
}

/// `len` bytes at `at`; `None` past the end.
fn bytes_at(file: &mut (impl Read + Seek + ?Sized), at: u64, len: usize) -> Option<Vec<u8>> {
    file.seek(SeekFrom::Start(at)).ok()?;
    let mut buf = vec![0; len];
    file.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// Big-endian numbers in a buffer; `None` past its end.
fn u16_in(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_in(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(family: &str, weight: u16, italic: bool, source: &str, ranges: &[(u32, u32)]) -> FontFace {
        FontFace { family: family.into(), weight, italic, stretch: 5, source: source.into(), index: 0, ranges: ranges.to_vec() }
    }

    #[test]
    fn an_installed_family_draws_with_one_face_of_normal_width() {
        let condensed = FontFace { stretch: 3, ..face("Sans", 700, false, "condensed", &[]) };
        let faces = [condensed, face("Sans", 700, false, "bold", &[]), face("Sans", 700, false, "bold-copy", &[])];
        let r = resolve_in(&faces, 700, false).unwrap();
        assert_eq!(r.faces.iter().map(|f| f.source.as_str()).collect::<Vec<_>>(), ["bold"]);
    }

    #[test]
    fn weights_are_matched_as_css_matches_them() {
        let w = [100, 300, 400, 700, 900];
        assert_eq!(nearest_weight(&w, 400), Some(400));
        assert_eq!(nearest_weight(&[300, 600], 500), Some(300));
        assert_eq!(nearest_weight(&[300, 500, 600], 450), Some(500));
        assert_eq!(nearest_weight(&w, 600), Some(700));
        assert_eq!(nearest_weight(&[100, 400], 800), Some(400));
        assert_eq!(nearest_weight(&w, 200), Some(100));
        assert_eq!(nearest_weight(&[400, 700], 200), Some(400));
        assert_eq!(nearest_weight(&[], 400), None);
    }

    #[test]
    fn a_web_fonts_files_come_together_with_latin_first() {
        let faces = [
            face("Poppins", 400, false, "cyrillic-400", &[(0x400, 0x4ff)]),
            face("Poppins", 400, false, "latin-400", &[(0, 0xff), (0x2000, 0x206f)]),
            face("Poppins", 700, false, "latin-700", &[(0, 0xff)]),
            face("Poppins", 700, true, "latin-700-italic", &[(0, 0xff)]),
        ];
        let r = resolve_in(&faces, 400, false).unwrap();
        assert_eq!(r.faces.iter().map(|f| f.source.as_str()).collect::<Vec<_>>(), ["latin-400", "cyrillic-400"]);
        assert!(!r.synthetic_bold && !r.synthetic_italic);
        // Bold uses the bold face, not a synthetic one.
        let r = resolve_in(&faces, 700, false).unwrap();
        assert_eq!(r.faces[0].source, "latin-700");
        assert!(!r.synthetic_bold);
        // Italic at 400: the only italic face (700) is nearer by slant than any upright one.
        let r = resolve_in(&faces, 400, true).unwrap();
        assert_eq!(r.faces[0].source, "latin-700-italic");
        assert!(!r.synthetic_italic);
    }

    #[test]
    fn missing_bold_and_italic_are_left_to_synthesise() {
        let faces = [face("Oswald", 400, false, "a", &[]), face("Oswald", 500, false, "b", &[])];
        let r = resolve_in(&faces, 700, true).unwrap();
        assert_eq!(r.faces[0].source, "b");
        assert!(r.synthetic_bold && r.synthetic_italic);
    }

    #[test]
    fn unicode_ranges_parse_as_css_writes_them() {
        assert_eq!(parse_unicode_range("U+0000-00FF, U+0131, U+0152-0153"), vec![(0, 0xff), (0x131, 0x131), (0x152, 0x153)]);
        assert_eq!(parse_unicode_range("U+4??"), vec![(0x400, 0x4ff)]);
        assert_eq!(parse_unicode_range("nonsense, U+20AC"), vec![(0x20ac, 0x20ac)]);
    }

    #[test]
    fn registered_faces_replace_their_own_source() {
        register([face("Test Family Registry", 400, false, "/nowhere/a.woff2", &[])]);
        register([face("Test Family Registry", 700, false, "/nowhere/a.woff2", &[])]);
        let mine: Vec<FontFace> = registered().into_iter().filter(|f| f.family == "Test Family Registry").collect();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].weight, 700);
        assert!(families().iter().any(|f| f.name == "Test Family Registry" && f.registered));
        assert_eq!(resolve("test family registry", 400, false).unwrap().faces[0].source, "/nowhere/a.woff2");
    }

    #[test]
    fn installed_fonts_are_found_by_their_family_names() {
        // Only where the system has the font: macOS ships Georgia and Helvetica.
        if !Path::new("/System/Library/Fonts/Supplemental/Georgia.ttf").exists() {
            return;
        }
        let georgia = resolve("Georgia", 400, false).unwrap();
        assert!(georgia.faces[0].source.ends_with("Georgia.ttf"));
        let bold = resolve("Georgia", 700, false).unwrap();
        assert!(bold.faces[0].source.ends_with("Georgia Bold.ttf"), "{:?}", bold.faces[0]);
        assert!(!bold.synthetic_bold);
        // A collection's faces by index: Helvetica.ttc holds the regular and the bold.
        let helvetica = resolve("Helvetica", 700, false).unwrap();
        assert!(helvetica.faces[0].source.ends_with("Helvetica.ttc"));
        let regular = resolve("Helvetica", 400, false).unwrap();
        assert_ne!(helvetica.faces[0].index, regular.faces[0].index);
        // No private UI fonts in the menu.
        assert!(families().iter().all(|f| !f.name.starts_with('.')));
    }
}
