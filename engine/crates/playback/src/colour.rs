//! A clip's CapCut colour materials as the compositor's grade (docs/parity/colour.md): the
//! parts of CapCut's colour bundle beyond the Adjust sliders and primary wheels.

use std::path::Path;
use std::sync::Arc;

use openrip_model::{CurvePoint, Project, Segment};
use openrip_platform::assets;
use openrip_render::{Curves, Hsl, RgbaImage};

/// CapCut's fade lookup table from its colour bundle: a 289×17 PNG (17 grids of 17×17, as the
/// exposure tables) stored inside `fade_max.texture`, an AmazingEngine texture file. `None`
/// when the bundle or the table isn't there (the fade slider is then left out).
pub fn fade_table(bundle: &Path) -> Option<RgbaImage> {
    let bytes = assets::read(&bundle.join("AmazingFeature_adjustColor").join("image").join("fade_max.texture")).ok()?;
    let start = bytes.windows(8).position(|w| w == b"\x89PNG\r\n\x1a\n")?;
    let mut dec = png::Decoder::new(std::io::Cursor::new(&bytes[start..]));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let px = &buf[..info.buffer_size()];
    let data: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => px.to_vec(),
        png::ColorType::Rgb => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        _ => return None,
    };
    ((info.width, info.height) == (289, 17)).then_some(RgbaImage { width: info.width, height: info.height, data })
}

/// The clip's HSL ranges: CapCut keeps one material per range (`range` 1–8 its named ones,
/// 9 a colour picked with the eyedropper, up to ten).
pub fn hsl_of(project: &Project, seg: &Segment) -> Hsl {
    let mut hsl = Hsl::default();
    let mut picked = 0;
    for h in seg.attachments.iter().filter_map(|id| project.materials.hsl.iter().find(|h| &h.id == id)) {
        let shift = [h.hue, h.saturation, h.lightness];
        match (h.range, h.custom_color) {
            (1..=8, _) => hsl.ranges[h.range as usize - 1] = shift,
            (9, Some(c)) if picked < hsl.picked.len() => {
                hsl.picked[picked] = ([c.r, c.g, c.b], shift);
                picked += 1;
            }
            _ => {}
        }
    }
    hsl
}

/// The clip's tone curves, if it has any that change something.
pub fn curves_of(project: &Project, seg: &Segment) -> Option<Arc<Curves>> {
    let c = seg.attachments.iter().find_map(|id| project.materials.curves.iter().find(|c| &c.id == id))?;
    let points = |ch: &[CurvePoint]| -> Vec<openrip_render::CurvePoint> {
        let p = |(x, y): (f64, f64)| [x as f32, y as f32];
        ch.iter().map(|q| openrip_render::CurvePoint { anchor: p(q.anchor), left: p(q.left), right: p(q.right) }).collect()
    };
    let curves = Curves { luma: points(&c.luma), red: points(&c.red), green: points(&c.green), blue: points(&c.blue) };
    (!curves.is_identity()).then(|| Arc::new(curves))
}

#[cfg(test)]
mod tests {
    use super::*;
    use openrip_model::*;

    fn project(curves: ColorCurves) -> (Project, Segment) {
        let mut p = Project::new("p", "P", Canvas { width: 1080, height: 1920 }, FrameRate::new(30, 1));
        p.materials.curves.push(curves);
        let seg = Segment {
            id: "s".into(),
            material: MaterialId("m".into()),
            source: None,
            target: TimeRange::new(Micros(0), Micros(1_000_000)),
            speed: 1.0,
            reverse: false,
            change_pitch: false,
            visible: true,
            render_index: 0,
            transform: Transform::default(),
            crop: None,
            opacity: Animated::constant(1.0),
            volume: Animated::constant(1.0),
            attachments: vec![MaterialId("cu".into())],
        };
        (p, seg)
    }

    /// The fade table is the PNG inside the bundle's texture file; a bundle without one has no
    /// fade.
    #[test]
    fn the_fade_table_is_read_from_inside_its_texture_file() {
        let dir = std::env::temp_dir().join(format!("openrip-fade-{}", std::process::id()));
        let image = dir.join("AmazingFeature_adjustColor").join("image");
        std::fs::create_dir_all(&image).unwrap();
        let mut png_bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png_bytes, 289, 17);
            enc.set_color(png::ColorType::Rgb);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[7u8; 289 * 17 * 3]).unwrap();
        }
        let file = [b"%SerializedFormat%@\n header".as_slice(), &png_bytes, b"trailer"].concat();
        std::fs::write(image.join("fade_max.texture"), file).unwrap();
        let t = fade_table(&dir).unwrap();
        assert_eq!((t.width, t.height, &t.data[..4]), (289, 17, &[7u8, 7, 7, 255][..]));
        assert!(fade_table(&dir.join("missing")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hsl_materials_fill_the_named_ranges_and_picked_colours() {
        let (mut p, mut seg) = project(ColorCurves { id: MaterialId("cu".into()), luma: Vec::new(), red: Vec::new(), green: Vec::new(), blue: Vec::new() });
        let range = |id: &str, range: u8, custom: Option<&str>, h: f32, s: f32, l: f32| HslAdjust { id: MaterialId(id.into()), range, custom_color: custom.and_then(Rgba::from_hex), hue: h, saturation: s, lightness: l };
        p.materials.hsl.extend([range("h1", 2, None, 10.0, 0.0, -5.0), range("h2", 9, Some("#937d49"), 20.0, 21.0, 25.0), range("h3", 9, Some("#1149ff"), 0.0, 0.0, -3.0)]);
        seg.attachments.extend(["h1", "h2", "h3"].map(MaterialId::from));
        let hsl = hsl_of(&p, &seg);
        assert_eq!(hsl.ranges[1], [10.0, 0.0, -5.0]);
        assert_eq!(hsl.ranges[0], [0.0; 3]);
        assert_eq!(hsl.picked[0].1, [20.0, 21.0, 25.0]);
        assert!((hsl.picked[1].0[2] - 1.0).abs() < 1e-6 && hsl.picked[1].1 == [0.0, 0.0, -3.0]);
        assert_eq!(hsl.picked[2].1, [0.0; 3]);
    }

    #[test]
    fn empty_curves_draw_nothing_and_a_bent_one_is_kept() {
        let empty = ColorCurves { id: MaterialId("cu".into()), luma: Vec::new(), red: Vec::new(), green: Vec::new(), blue: Vec::new() };
        let (p, seg) = project(empty.clone());
        assert!(curves_of(&p, &seg).is_none());
        let luma = vec![
            openrip_model::CurvePoint { anchor: (0.0, 0.1), left: (0.0, 0.1), right: (0.33, 0.4) },
            openrip_model::CurvePoint { anchor: (1.0, 0.9), left: (0.67, 0.6), right: (1.0, 0.9) },
        ];
        let (p, seg) = project(ColorCurves { luma, ..empty });
        let c = curves_of(&p, &seg).unwrap();
        assert_eq!((c.luma.len(), c.luma[0].anchor, c.red.len()), (2, [0.0, 0.1], 0));
    }
}
