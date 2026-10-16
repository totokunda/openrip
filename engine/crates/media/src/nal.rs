//! Just enough H.264/HEVC bitstream parsing to tell an IDR keyframe (decoder state fully
//! reset) from an open-GOP one (later pictures may still reference what came before).

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

pub(crate) fn detect(codec_id: ff::AVCodecID, extradata: &[u8]) -> Option<(Codec, Framing)> {
    let codec = match codec_id {
        ff::AVCodecID::AV_CODEC_ID_H264 => Codec::H264,
        ff::AVCodecID::AV_CODEC_ID_HEVC => Codec::Hevc,
        _ => return None,
    };
    // avcC / hvcC configuration records start with version 1; Annex B extradata starts with 0.
    let framing = match (codec, extradata.first()) {
        (Codec::H264, Some(1)) if extradata.len() > 4 => Framing::LengthPrefixed((extradata[4] & 3) as usize + 1),
        (Codec::Hevc, Some(1)) if extradata.len() > 21 => Framing::LengthPrefixed((extradata[21] & 3) as usize + 1),
        _ => Framing::AnnexB,
    };
    Some((codec, framing))
}

/// Calls `f` with the first header byte of each NAL unit until it returns true.
fn any_nal(framing: Framing, data: &[u8], f: impl Fn(u8) -> bool) -> bool {
    match framing {
        Framing::LengthPrefixed(n) => {
            let mut i = 0;
            while i + n < data.len() {
                let len = data[i..i + n].iter().fold(0usize, |acc, b| (acc << 8) | *b as usize);
                if f(data[i + n]) {
                    return true;
                }
                i += n + len;
            }
            false
        }
        Framing::AnnexB => {
            let mut i = 0;
            while i + 3 < data.len() {
                if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
                    if f(data[i + 3]) {
                        return true;
                    }
                    i += 3;
                } else {
                    i += 1;
                }
            }
            false
        }
    }
}

/// True if the access unit contains an IDR picture.
pub(crate) fn is_idr(codec: Codec, framing: Framing, data: &[u8]) -> bool {
    match codec {
        Codec::H264 => any_nal(framing, data, |h| h & 0x1f == 5),
        Codec::Hevc => any_nal(framing, data, |h| matches!((h >> 1) & 0x3f, 19 | 20)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_idr_in_both_framings() {
        // Length-prefixed (4 bytes): SEI (6) then IDR slice (5).
        let au = [0, 0, 0, 2, 0x06, 0xff, 0, 0, 0, 2, 0x65, 0x88];
        assert!(is_idr(Codec::H264, Framing::LengthPrefixed(4), &au));
        // Non-IDR slice (1) only.
        let au = [0, 0, 0, 2, 0x41, 0x9a];
        assert!(!is_idr(Codec::H264, Framing::LengthPrefixed(4), &au));
        // Annex B HEVC: AUD (35), CRA (21): open GOP, not IDR.
        let au = [0, 0, 0, 1, 0x46, 0x01, 0x10, 0, 0, 1, 0x2a, 0x01, 0xaf];
        assert!(!is_idr(Codec::Hevc, Framing::AnnexB, &au));
        // Annex B HEVC: IDR_W_RADL (19).
        let au = [0, 0, 1, 0x26, 0x01, 0xaf];
        assert!(is_idr(Codec::Hevc, Framing::AnnexB, &au));
    }
}
