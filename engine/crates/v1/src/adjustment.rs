//! Adjustment layers from the app (a filter clip with `adjustment: true`, lib/adjustment.ts):
//! each becomes a segment on an adjustment track whose attachments are the colour tools of its
//! `color`, as a video's, with its keys and masks; the engine draws it over what is beneath.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::color::{hsl_id, lut_id, slider_id};
    use crate::{import_v1_json, Imported};
    use openrip_model::*;

    fn doc(extra: serde_json::Value) -> serde_json::Value {
        let mut clip = json!({
            "clipId": "adj", "type": "filter", "timelineId": "TF", "name": "Adjust1", "adjustment": true,
            "startTick": "1000000", "endTick": "3000000", "trimStartTick": "0", "trimEndTick": "0",
            "color": {"adjust": {"brightness": 25, "saturation": -10}, "hsl": {"red": {"hue": 10}}, "lut": {"path": "/tmp/x.cube", "intensity": 80}},
            "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 100},
            "masks": [],
            "keyframes": {"adjust:brightness": [{"frame": 0, "value": 0}, {"frame": 24, "value": 50}]}
        });
        for (k, v) in extra.as_object().unwrap() {
            clip[k] = v.clone();
        }
        json!({
            "version": "1.0.0",
            "settings": {"fps": 24, "aspectRatio": {"width": 16, "height": 9, "id": "16:9"}},
            "assets": {},
            "timeline": {"tracks": [{"type": "filter", "timelineId": "TF"}], "clips": [clip]}
        })
    }

    #[test]
    fn an_adjustment_layer_becomes_a_segment_on_an_adjustment_track_with_the_colour_tools() {
        let Imported { project, .. } = import_v1_json(&doc(json!({}))).unwrap();
        let track = project.tracks.iter().find(|t| t.segments.iter().any(|s| s.id == "adj")).unwrap();
        assert_eq!(track.kind, TrackKind::Adjustment);
        let seg = &track.segments[0];
        let has = |id: MaterialId| seg.attachments.contains(&id);
        assert!(has(slider_id("adj", "brightness")) && has(slider_id("adj", "saturation")) && has(hsl_id("adj", "red")) && has(lut_id("adj")));
        // Its keys drive the slider over the bar's own time: 0 at its start, 1 (50 on CapCut's
        // scale) a second in.
        let e = project.materials.effects.iter().find(|e| e.id == slider_id("adj", "brightness")).unwrap();
        assert!((seg.effect_at(e, Micros(1_000_000)).params["intensity"] - 1.0).abs() < 1e-9);
        assert!(seg.effect_at(e, Micros(0)).params["intensity"].abs() < 1e-9);
    }

    /// An effect bar's masks (its Mask tab) become masks on its segment, drawn inside which the
    /// effect shows; the Log wheels, Particles and a canvas pattern come through as well.
    #[test]
    fn effect_bar_masks_log_wheels_particles_and_canvas_patterns_import() {
        let mask = json!({"id": "m1", "tool": "shape", "featherAmount": 0, "transform": {"x": 0, "y": 0, "width": 1066.6666666666667, "height": 600, "scaleX": 1, "scaleY": 1},
            "keyframes": {"0": {"shapeBounds": {"x": 0, "y": 0, "width": 400, "height": 300, "shapeType": "rectangle"}}}});
        let bar = import_v1_json(&doc(json!({"adjustment": false, "effectId": "invert", "masks": [mask]}))).unwrap().project;
        let seg = bar.tracks.iter().flat_map(|t| &t.segments).find(|s| s.id == "adj").unwrap();
        assert_eq!(seg.attachments.iter().filter(|a| bar.materials.masks.iter().any(|m| &m.id == *a)).count(), 1);
        let track = bar.tracks.iter().find(|t| t.segments.iter().any(|s| s.id == "adj")).unwrap();
        assert_eq!(track.kind, TrackKind::Effect);

        // The Log wheels: their own values, the shared strength.
        let color = json!({"wheels": {"mode": "log", "intensity": 60, "lift": {"red": 0.9}, "log": {"lift": {"luma": 0.5}, "offset": {"red": 0.25}}}, "adjust": {"particles": 40}});
        let layer = import_v1_json(&doc(json!({"color": color}))).unwrap().project;
        let w = layer.materials.color_wheels.iter().find(|w| w.id == crate::color::wheels_id("adj")).unwrap();
        assert!(w.log && (w.intensity - 0.6).abs() < 1e-9);
        assert_eq!((w.lift.luma, w.lift.red, w.offset.red), (0.5, 0.0, 0.25));
        // Particles is a slider on CapCut's 0 to 100 scale.
        let e = layer.materials.effects.iter().find(|e| e.id == slider_id("adj", "particles")).unwrap();
        assert!((e.params["intensity"] - 0.4).abs() < 1e-9);
        // Primary mode ignores the log values.
        let primary = import_v1_json(&doc(json!({"color": {"wheels": {"lift": {"red": 0.9}, "log": {"lift": {"luma": 0.5}}}}}))).unwrap().project;
        let w = primary.materials.color_wheels.iter().find(|w| w.id == crate::color::wheels_id("adj")).unwrap();
        assert!(!w.log && w.lift.red == 0.9 && w.lift.luma == 0.0);
    }

    /// A filter clip that isn't an adjustment layer stays a filter bar.
    #[test]
    fn other_filter_bars_stay_filters() {
        let Imported { project, .. } = import_v1_json(&doc(json!({"adjustment": false}))).unwrap();
        assert!(project.tracks.iter().all(|t| t.kind != TrackKind::Adjustment));
    }
}
