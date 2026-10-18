//! The Audio tab's fields on the app's video and audio clips (lib/types.ts `ClipAudio`), as
//! the materials a CapCut draft gives the engine for the same settings:
//!
//! - `audioEffects`: `[{type, params?, name?, id?}]`, voice effects played one after another
//!   (lib/audio-effects.ts lists the presets). `type` names one of OpenRip's own effects
//!   (`openrip_audio::voice`), with its parameters by name; an entry with `type: "draft"` and
//!   `id` is a converted CapCut clip's own voice filter (its bundle), kept as it is.
//! - `loudness`: `{enabled, target, measured?, peak?}`, CapCut's "Normalize loudness": the
//!   clip turned to `target` LUFS from the loudness `measured` over its range (LUFS) and its
//!   peak (dBFS), which the app measures with the engine's meter (CapCut's `loudnesses`).
//! - `channel`: "none", "left", "right" or "mono", the channel fill (CapCut's "Fill channel":
//!   "left" plays the left channel on both sides; "mono" is OpenRip's own).
//! - `beats`: `{manual?, auto?, everyBeat?, detected?}`, beat markers in seconds of the
//!   clip's media (CapCut's `beats`): `detected` are a source app's automatic ones
//!   (`[{time, downbeat}]`); without them the app shows the engine's.
//!
//! On a converted CapCut clip each field the app changed replaces the draft's own.

use openrip_model::*;
use serde_json::{json, Map, Value};

use crate::{b, f, s};

fn effect_id(clip: &str, i: usize) -> MaterialId {
    MaterialId(format!("{clip}-afx-{i}"))
}

fn loudness_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-loudness"))
}

fn channels_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-channels"))
}

fn beats_id(clip: &str) -> MaterialId {
    MaterialId(format!("{clip}-beats"))
}

/// Replace the segment's voice effects with the app's list. A "draft" entry keeps the draft
/// effect it names (if the segment has it).
pub(crate) fn set_effects(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    let was: Vec<MaterialId> = attachments.iter().filter(|a| materials.effects.iter().any(|e| &e.id == *a && e.category == EffectCategory::Audio)).cloned().collect();
    attachments.retain(|a| !was.contains(a));
    let ours = format!("{clip}-afx-");
    materials.effects.retain(|e| !e.id.0.starts_with(&ours));
    for (i, e) in value.and_then(Value::as_array).into_iter().flatten().enumerate() {
        let ty = s(e, "type");
        if ty == "draft" {
            let id = MaterialId(s(e, "id"));
            if was.contains(&id) {
                attachments.push(id);
            }
            continue;
        }
        if ty.is_empty() {
            continue;
        }
        let params = e.get("params").and_then(Value::as_object).into_iter().flatten().filter_map(|(k, v)| Some((k.clone(), v.as_f64()?))).collect();
        materials.effects.push(Effect {
            id: effect_id(clip, i),
            category: EffectCategory::Audio,
            name: s(e, "name"),
            params,
            builtin: Some(ty),
            resource: None,
            library: None,
            text_style: None,
        });
        attachments.push(effect_id(clip, i));
    }
}

/// Replace the segment's loudness normalisation with the app's.
pub(crate) fn set_loudness(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.loudness.iter().any(|l| &l.id == a));
    materials.remove(&loudness_id(clip));
    let Some(v) = value.filter(|v| v.is_object()) else { return };
    materials.loudness.push(Loudness {
        id: loudness_id(clip),
        enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        target: f(v, "target", -23.0) as f32,
        measured: v.get("measured").and_then(Value::as_f64).map(|m| m as f32),
        peak: f(v, "peak", 0.0) as f32,
    });
    attachments.push(loudness_id(clip));
}

/// Replace the segment's channel fill with the app's.
pub(crate) fn set_channel(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.channels.iter().any(|c| &c.id == a));
    materials.remove(&channels_id(clip));
    let fill = match value.and_then(Value::as_str) {
        Some("left") => ChannelFill::Left,
        Some("right") => ChannelFill::Right,
        Some("mono") => ChannelFill::Mono,
        _ => return,
    };
    materials.channels.push(ChannelMap { id: channels_id(clip), fill });
    attachments.push(channels_id(clip));
}

/// Replace the segment's beat markers with the app's.
pub(crate) fn set_beats(clip: &str, value: Option<&Value>, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    attachments.retain(|a| !materials.beats.iter().any(|m| &m.id == a));
    materials.remove(&beats_id(clip));
    let Some(v) = value.filter(|v| v.is_object()) else { return };
    let secs = |x: &Value| x.as_f64().map(Micros::from_secs_f64);
    materials.beats.push(Beats {
        id: beats_id(clip),
        manual: v.get("manual").and_then(Value::as_array).into_iter().flatten().filter_map(secs).collect(),
        auto: b(v, "auto"),
        every_beat: b(v, "everyBeat"),
        detected: v.get("detected").and_then(Value::as_array).into_iter().flatten().filter_map(|d| Some(Beat { at: secs(d.get("time")?)?, downbeat: b(d, "downbeat") })).collect(),
    });
    attachments.push(beats_id(clip));
}

/// All four, for a new clip of the app's own.
pub(crate) fn attach(clip_id: &str, clip: &Value, materials: &mut Materials, attachments: &mut Vec<MaterialId>) {
    set_effects(clip_id, clip.get("audioEffects"), materials, attachments);
    set_loudness(clip_id, clip.get("loudness"), materials, attachments);
    set_channel(clip_id, clip.get("channel"), materials, attachments);
    set_beats(clip_id, clip.get("beats"), materials, attachments);
}

/// A segment's voice effects, loudness normalisation, channel fill and beat markers as the
/// app's fields.
pub(crate) fn emit(project: &Project, seg: &Segment, clip: &mut Map<String, Value>) {
    let m = &project.materials;
    let attached = |id: &MaterialId| seg.attachments.contains(id);
    let effects: Vec<Value> = seg
        .attachments
        .iter()
        .filter_map(|id| m.effects.iter().find(|e| &e.id == id && e.category == EffectCategory::Audio))
        .map(|e| match (&e.resource, &e.builtin) {
            (None, Some(ty)) => json!({ "type": ty, "name": e.name, "params": e.params }),
            _ => json!({ "type": "draft", "id": e.id.0, "name": e.name }),
        })
        .collect();
    clip.insert("audioEffects".into(), Value::Array(effects));
    let loud = m.loudness.iter().find(|l| attached(&l.id));
    clip.insert("loudness".into(), loud.map_or(Value::Null, |l| json!({ "enabled": l.enabled, "target": l.target as f64, "measured": l.measured.map(|v| v as f64), "peak": l.peak as f64 })));
    let fill = m.channels.iter().find(|c| attached(&c.id)).map_or(ChannelFill::None, |c| c.fill);
    clip.insert("channel".into(), json!(fill));
    let beats = m.beats.iter().find(|x| attached(&x.id));
    clip.insert(
        "beats".into(),
        beats.map_or(Value::Null, |x| {
            json!({
                "manual": x.manual.iter().map(|t| t.as_secs_f64()).collect::<Vec<_>>(),
                "auto": x.auto,
                "everyBeat": x.every_beat,
                "detected": x.detected.iter().map(|d| json!({ "time": d.at.as_secs_f64(), "downbeat": d.downbeat })).collect::<Vec<_>>(),
            })
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_become_materials_and_replace_the_drafts() {
        let mut m = Materials::default();
        // A draft's own voice filter (a bundle), loudness and channel map, attached.
        m.effects.push(Effect { id: "draft-fx".into(), category: EffectCategory::Audio, name: "Deep".into(), params: Default::default(), builtin: None, resource: Some("/bundle".into()), library: None, text_style: None });
        m.loudness.push(Loudness { id: "draft-loud".into(), enabled: true, target: -23.0, measured: Some(-30.0), peak: -6.0 });
        m.channels.push(ChannelMap { id: "draft-ch".into(), fill: ChannelFill::None });
        let mut att: Vec<MaterialId> = vec!["draft-fx".into(), "draft-loud".into(), "draft-ch".into(), "other".into()];
        let fields = json!({
            "audioEffects": [{"type": "draft", "id": "draft-fx", "name": "Deep"}, {"type": "reverb", "name": "Hall", "params": {"decay": 3.0, "mix": 40}}],
            "loudness": {"enabled": true, "target": -23, "measured": -18.5, "peak": -1.0},
            "channel": "left",
            "beats": {"manual": [1.5, 0.25], "auto": true, "detected": [{"time": 0.5, "downbeat": true}]}
        });
        attach("c", &fields, &mut m, &mut att);
        assert_eq!(att, vec![MaterialId::from("other"), "draft-fx".into(), effect_id("c", 1), loudness_id("c"), channels_id("c"), beats_id("c")]);
        let fx = m.effects.iter().find(|e| e.id == effect_id("c", 1)).unwrap();
        assert_eq!((fx.category, fx.builtin.as_deref(), fx.params.get("decay").copied(), fx.name.as_str()), (EffectCategory::Audio, Some("reverb"), Some(3.0), "Hall"));
        let l = m.loudness.iter().find(|l| l.id == loudness_id("c")).unwrap();
        assert_eq!((l.measured, l.target), (Some(-18.5), -23.0));
        assert!((l.gain() - 10f32.powf(-4.5 / 20.0)).abs() < 1e-6);
        assert_eq!(m.channels.iter().find(|c| c.id == channels_id("c")).unwrap().fill, ChannelFill::Left);
        let bt = m.beats.iter().find(|x| x.id == beats_id("c")).unwrap();
        assert_eq!(bt.shown(&[]), vec![Micros(250_000), Micros(500_000), Micros(1_500_000)]);
        // Back as the app's fields.
        let seg = Segment { id: "c".into(), material: "m".into(), source: None, target: TimeRange::new(Micros(0), Micros(1_000_000)), speed: 1.0, reverse: false, change_pitch: false, visible: true, render_index: 0, transform: Transform::default(), crop: None, opacity: Animated::constant(1.0), volume: Animated::constant(1.0), attachments: att.clone(), keyframes: vec![] };
        let mut p = Project::new("p", "p", Canvas { width: 16, height: 16 }, FrameRate::new(30, 1));
        p.materials = m.clone();
        let mut out = Map::new();
        emit(&p, &seg, &mut out);
        assert_eq!(out["audioEffects"][0], json!({"type": "draft", "id": "draft-fx", "name": "Deep"}));
        assert_eq!(out["audioEffects"][1]["type"], "reverb");
        assert_eq!(out["channel"], "left");
        assert_eq!(out["loudness"]["measured"], -18.5);
        assert_eq!(out["beats"]["manual"], json!([1.5, 0.25]));
        // Empty fields take them off; the draft's effect goes when the list leaves it out.
        attach("c", &json!({"audioEffects": [], "loudness": null, "channel": "none", "beats": null}), &mut m, &mut att);
        assert_eq!(att, vec![MaterialId::from("other")]);
        assert!(m.effects.iter().all(|e| e.id != effect_id("c", 1)));
    }
}
