//! Just enough H.264/HEVC bitstream parsing to tell an IDR keyframe (decoder state fully
//! reset) from an open-GOP one (later pictures may still reference what came before), and
//! to recognise pictures nothing references (safe to skip while seeking).

use ffmpeg_sys_next as ff;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Codec {
    H264,
    Hevc,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Framing {
    /// MP4-style: each NAL unit is preceded by its length in this many bytes.
    LengthPrefixed(usize),
    /// Annex B start codes (MPEG-TS, raw streams).
    AnnexB,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) struct Bitstream {
    pub codec: Codec,
    pub framing: Framing,
    /// Highest HEVC temporal sub-layer id, when the configuration record gives it.
    pub max_temporal_id: Option<u8>,
}

pub(crate) fn detect(codec_id: ff::AVCodecID, extradata: &[u8]) -> Option<Bitstream> {
    let codec = match codec_id {
        ff::AVCodecID::AV_CODEC_ID_H264 => Codec::H264,
        ff::AVCodecID::AV_CODEC_ID_HEVC => Codec::Hevc,
        _ => return None,
    };
    // avcC / hvcC configuration records start with version 1; Annex B extradata starts with 0.
    let (framing, max_temporal_id) = match (codec, extradata.first()) {
        (Codec::H264, Some(1)) if extradata.len() > 4 => (Framing::LengthPrefixed((extradata[4] & 3) as usize + 1), None),
        (Codec::Hevc, Some(1)) if extradata.len() > 21 => {
            let layers = (extradata[21] >> 3) & 7; // numTemporalLayers, 0 = unknown
            (Framing::LengthPrefixed((extradata[21] & 3) as usize + 1), layers.checked_sub(1))
        }
        _ => (Framing::AnnexB, None),
    };
    Some(Bitstream { codec, framing, max_temporal_id })
}

/// Calls `f` with each NAL unit (from its header) until it returns true.
fn any_nal(framing: Framing, data: &[u8], mut f: impl FnMut(&[u8]) -> bool) -> bool {
    match framing {
        Framing::LengthPrefixed(n) => {
            let mut i = 0;
            while i + n < data.len() {
                let len = data[i..i + n].iter().fold(0usize, |acc, b| (acc << 8) | *b as usize);
                let end = (i + n + len).min(data.len());
                if end > i + n && f(&data[i + n..end]) {
                    return true;
                }
                i += n + len;
            }
            false
        }
        Framing::AnnexB => {
            let mut starts = Vec::new();
            let mut i = 0;
            while i + 3 < data.len() {
                if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
                    starts.push(i + 3);
                    i += 3;
                } else {
                    i += 1;
                }
            }
            starts.iter().enumerate().any(|(k, &s)| {
                let nal = &data[s..starts.get(k + 1).map_or(data.len(), |&e| e - 3)];
                !nal.is_empty() && f(nal)
            })
        }
    }
}

impl Bitstream {
    /// True if the access unit contains an IDR picture.
    pub(crate) fn is_idr(&self, data: &[u8]) -> bool {
        match self.codec {
            Codec::H264 => any_nal(self.framing, data, |n| n[0] & 0x1f == 5),
            Codec::Hevc => any_nal(self.framing, data, |n| matches!((n[0] >> 1) & 0x3f, 19 | 20)),
        }
    }

    /// True if no later picture can reference this one, so a seek that only needs it as a
    /// stepping stone can skip it entirely. H.264: every slice has `nal_ref_idc == 0`. HEVC:
    /// every slice is a sub-layer non-reference picture in the highest temporal sub-layer
    /// (lower sub-layers' "non-reference" pictures may still be referenced from above).
    pub(crate) fn is_disposable(&self, data: &[u8]) -> bool {
        let mut slices = 0;
        let referenced = any_nal(self.framing, data, |n| match self.codec {
            Codec::H264 => {
                let kind = n[0] & 0x1f;
                if (1..=5).contains(&kind) {
                    slices += 1;
                    (n[0] >> 5) & 3 != 0
                } else {
                    false
                }
            }
            Codec::Hevc => {
                let kind = (n[0] >> 1) & 0x3f;
                if kind <= 31 {
                    slices += 1;
                    let tid = n.get(1).map(|b| (b & 7).saturating_sub(1));
                    let sub_layer_non_ref = kind <= 14 && kind % 2 == 0;
                    !(sub_layer_non_ref && tid.is_some() && tid == self.max_temporal_id)
                } else {
                    false
                }
            }
        });
        slices > 0 && !referenced
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H264: Bitstream = Bitstream { codec: Codec::H264, framing: Framing::LengthPrefixed(4), max_temporal_id: None };
    const HEVC: Bitstream = Bitstream { codec: Codec::Hevc, framing: Framing::AnnexB, max_temporal_id: Some(2) };

    #[test]
    fn finds_idr_in_both_framings() {
        // Length-prefixed (4 bytes): SEI (6) then IDR slice (5).
        assert!(H264.is_idr(&[0, 0, 0, 2, 0x06, 0xff, 0, 0, 0, 2, 0x65, 0x88]));
        // Non-IDR slice (1) only.
        assert!(!H264.is_idr(&[0, 0, 0, 2, 0x41, 0x9a]));
        // Annex B HEVC: AUD (35), CRA (21): open GOP, not IDR.
        assert!(!HEVC.is_idr(&[0, 0, 0, 1, 0x46, 0x01, 0x10, 0, 0, 1, 0x2a, 0x01, 0xaf]));
        // Annex B HEVC: IDR_W_RADL (19).
        assert!(HEVC.is_idr(&[0, 0, 1, 0x26, 0x01, 0xaf]));
    }

    #[test]
    fn classifies_disposable_pictures() {
        // H.264 non-reference B slice (nal_ref_idc 0, type 1) vs reference P slice (ref_idc 2).
        assert!(H264.is_disposable(&[0, 0, 0, 2, 0x01, 0x9e]));
        assert!(!H264.is_disposable(&[0, 0, 0, 2, 0x41, 0x9a]));
        // SEI only: not a picture.
        assert!(!H264.is_disposable(&[0, 0, 0, 2, 0x06, 0xff]));
        // HEVC TRAIL_N (0) in the top sub-layer (tid 2 -> header byte 2 = 3) is disposable…
        assert!(HEVC.is_disposable(&[0, 0, 1, 0x00, 0x03, 0xaf]));
        // …but not in a lower sub-layer (tid 1), where a higher layer may reference it.
        assert!(!HEVC.is_disposable(&[0, 0, 1, 0x00, 0x02, 0xaf]));
        // TRAIL_R (1) is always a reference.
        assert!(!HEVC.is_disposable(&[0, 0, 1, 0x02, 0x03, 0xaf]));
    }
}
