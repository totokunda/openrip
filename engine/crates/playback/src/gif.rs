//! A small GIF decoder for animated stickers: every frame composed onto the GIF's screen as a
//! browser shows it (each frame's disposal applied before the next, transparent where nothing
//! has been drawn), as straight-alpha RGBA, with how long it shows.

use openrip_render::RgbaImage;

/// One composed frame and how long it shows, in milliseconds.
pub struct Frame {
    pub image: RgbaImage,
    pub delay_ms: u32,
}

/// Decode every frame of a GIF; `None` if it isn't one.
pub fn decode(bytes: &[u8]) -> Option<Vec<Frame>> {
    if !bytes.starts_with(b"GIF87a") && !bytes.starts_with(b"GIF89a") {
        return None;
    }
    let mut r = Reader { bytes, at: 6 };
    let (w, h) = (r.u16()? as usize, r.u16()? as usize);
    let packed = r.u8()?;
    r.at += 2; // background index, aspect ratio
    let global = if packed & 0x80 != 0 { Some(r.take(3 << ((packed & 7) + 1))?) } else { None };
    if w == 0 || h == 0 {
        return None;
    }
    let mut canvas = vec![0u8; w * h * 4];
    let mut frames = Vec::new();
    // The graphic control of the next image: delay (1/100 s), transparent index, disposal.
    let (mut delay, mut transparent, mut disposal) = (0u16, None::<u8>, 0u8);
    loop {
        match r.u8()? {
            0x21 => {
                let label = r.u8()?;
                if label == 0xF9 {
                    let size = r.u8()? as usize;
                    let block = r.take(size)?;
                    if size >= 4 {
                        disposal = (block[0] >> 2) & 7;
                        delay = u16::from_le_bytes([block[1], block[2]]);
                        transparent = (block[0] & 1 != 0).then_some(block[3]);
                    }
                }
                r.skip_blocks()?;
            }
            0x2C => {
                let (x0, y0, fw, fh) = (r.u16()? as usize, r.u16()? as usize, r.u16()? as usize, r.u16()? as usize);
                let packed = r.u8()?;
                let local = if packed & 0x80 != 0 { Some(r.take(3 << ((packed & 7) + 1))?) } else { None };
                let palette = local.or(global).unwrap_or(&[]);
                let min_code = r.u8()?;
                let data = r.blocks()?;
                let mut indices = lzw(min_code, &data, fw * fh);
                if packed & 0x40 != 0 {
                    indices = deinterlace(&indices, fw, fh);
                }
                // "Restore to previous" needs the screen as it was before this frame.
                let before = (disposal == 3).then(|| canvas.clone());
                for y in 0..fh.min(h.saturating_sub(y0)) {
                    for x in 0..fw.min(w.saturating_sub(x0)) {
                        let i = indices[y * fw + x];
                        if Some(i) == transparent {
                            continue;
                        }
                        let Some(rgb) = palette.get(i as usize * 3..i as usize * 3 + 3) else { continue };
                        let o = ((y0 + y) * w + x0 + x) * 4;
                        canvas[o..o + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
                    }
                }
                // Browsers show very short delays as 1/10 s.
                let delay_ms = if delay < 2 { 100 } else { delay as u32 * 10 };
                frames.push(Frame { image: RgbaImage { width: w as u32, height: h as u32, data: canvas.clone() }, delay_ms });
                match disposal {
                    // Restore to background: the frame's area clears.
                    2 => {
                        for y in y0..(y0 + fh).min(h) {
                            canvas[(y * w + x0) * 4..(y * w + (x0 + fw).min(w)) * 4].fill(0);
                        }
                    }
                    3 => canvas = before.unwrap_or(canvas),
                    _ => {}
                }
                (delay, transparent, disposal) = (0, None, 0);
            }
            _ => break,
        }
    }
    (!frames.is_empty()).then_some(frames)
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Option<u8> {
        let b = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(b)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes([self.u8()?, self.u8()?]))
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.bytes.get(self.at..self.at + n)?;
        self.at += n;
        Some(s)
    }
    /// Data sub-blocks up to the empty one, joined.
    fn blocks(&mut self) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        loop {
            let n = self.u8()? as usize;
            if n == 0 {
                return Some(out);
            }
            out.extend_from_slice(self.take(n)?);
        }
    }
    fn skip_blocks(&mut self) -> Option<()> {
        loop {
            let n = self.u8()? as usize;
            if n == 0 {
                return Some(());
            }
            self.take(n)?;
        }
    }
}

/// GIF's variable-width LZW: `len` colour indices from the image's data (short data is padded
/// with 0).
fn lzw(min_code: u8, data: &[u8], len: usize) -> Vec<u8> {
    let min = min_code.clamp(2, 11) as u32;
    let (clear, end) = (1u32 << min, (1u32 << min) + 1);
    let (mut size, mut next) = (min + 1, end + 1);
    // Each code's string: its last byte, the code before it, and its first byte.
    let mut suffix = [0u8; 4096];
    let mut prefix = [0u16; 4096];
    let mut first = [0u8; 4096];
    for c in 0..clear as usize {
        suffix[c] = c as u8;
        first[c] = c as u8;
    }
    let mut out = Vec::with_capacity(len);
    let mut stack = Vec::with_capacity(4096);
    let (mut acc, mut bits) = (0u32, 0u32);
    let mut prev: Option<u32> = None;
    'read: for &byte in data {
        acc |= (byte as u32) << bits;
        bits += 8;
        while bits >= size {
            let code = acc & ((1 << size) - 1);
            acc >>= size;
            bits -= size;
            if code == clear {
                (size, next, prev) = (min + 1, end + 1, None);
                continue;
            }
            if code == end || code > next || out.len() >= len {
                break 'read;
            }
            let Some(p) = prev else {
                if code < clear {
                    out.push(code as u8);
                    prev = Some(code);
                }
                continue;
            };
            // A code not in the table yet (code == next) is the previous string plus its own
            // first byte.
            let (string, extra) = if code < next { (code, None) } else { (p, Some(first[p as usize])) };
            stack.clear();
            let mut c = string;
            while c > end && stack.len() < 4096 {
                stack.push(suffix[c as usize]);
                c = prefix[c as usize] as u32;
            }
            stack.push(c as u8);
            out.extend(stack.iter().rev());
            out.extend(extra);
            if next < 4096 {
                suffix[next as usize] = if code < next { first[code as usize] } else { first[p as usize] };
                prefix[next as usize] = p as u16;
                first[next as usize] = first[p as usize];
                next += 1;
                if next == 1 << size && size < 12 {
                    size += 1;
                }
            }
            prev = Some(code);
        }
    }
    out.resize(len, 0);
    out
}

/// Rows of an interlaced image in display order (every 8th from 0, every 8th from 4, every
/// 4th from 2, every 2nd from 1).
fn deinterlace(rows: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    let order = (0..h).step_by(8).chain((4..h).step_by(8)).chain((2..h).step_by(4)).chain((1..h).step_by(2));
    for (src, dst) in order.enumerate() {
        out[dst * w..dst * w + w].copy_from_slice(&rows[src * w..src * w + w]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Codes for a GIF's LZW stream, packed least significant bit first, at the widths a
    /// decoder reads them (`min` + 1 bits, growing as the table fills).
    fn pack(min: u32, codes: &[u32]) -> Vec<u8> {
        let (mut acc, mut bits, mut out) = (0u64, 0u32, Vec::new());
        let (mut size, mut next) = (min + 1, (1 << min) + 2);
        for (k, &c) in codes.iter().enumerate() {
            acc |= (c as u64) << bits;
            bits += size;
            while bits >= 8 {
                out.push(acc as u8);
                acc >>= 8;
                bits -= 8;
            }
            // Every code after the first data code adds a table entry.
            let data = c != 1 << min && c != (1 << min) + 1;
            if data && k > 1 {
                next += 1;
                if next == 1 << size && size < 12 {
                    size += 1;
                }
            }
        }
        if bits > 0 {
            out.push(acc as u8);
        }
        out
    }

    /// A 2×2, two-frame GIF: frame 1 red/green/blue/transparent, then a 1×1 white frame at the
    /// bottom right over it (the rest kept, disposal 1), 0.5 s each.
    fn sample() -> Vec<u8> {
        let mut g = b"GIF89a".to_vec();
        g.extend([2, 0, 2, 0, 0x81, 0, 0]); // 2×2, global table of 4
        g.extend([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
        let frame = |g: &mut Vec<u8>, rect: [u8; 4], codes: &[u32], transparent: Option<u8>| {
            g.extend([0x21, 0xF9, 4, (1 << 2) | transparent.is_some() as u8, 50, 0, transparent.unwrap_or(0), 0]);
            g.extend([0x2C, rect[0], 0, rect[1], 0, rect[2], 0, rect[3], 0, 0, 2]);
            let data = pack(2, codes);
            g.push(data.len() as u8);
            g.extend(&data);
            g.push(0);
        };
        // Clear, 0, 1, 2, 3, end: indices red, green, blue, white (white is transparent here).
        frame(&mut g, [0, 0, 2, 2], &[4, 0, 1, 2, 3, 5], Some(3));
        frame(&mut g, [1, 1, 1, 1], &[4, 3, 5], None);
        g.push(0x3B);
        g
    }

    #[test]
    fn frames_compose_with_transparency_and_delays() {
        let frames = decode(&sample()).unwrap();
        assert_eq!(frames.len(), 2);
        let px = |f: &Frame, i: usize| f.image.data[i * 4..i * 4 + 4].to_vec();
        assert_eq!((px(&frames[0], 0), px(&frames[0], 1), px(&frames[0], 2)), (vec![255, 0, 0, 255], vec![0, 255, 0, 255], vec![0, 0, 255, 255]));
        assert_eq!(px(&frames[0], 3), vec![0, 0, 0, 0]);
        // The second frame draws white at the bottom right and keeps the rest.
        assert_eq!((px(&frames[1], 0), px(&frames[1], 3)), (vec![255, 0, 0, 255], vec![255, 255, 255, 255]));
        assert_eq!((frames[0].delay_ms, frames[1].delay_ms), (500, 500));
        assert!(decode(b"not a gif").is_none());
    }

    /// Repeats come out of the table: "0 0 0 0" codes as 0, then the new code for "0 0".
    #[test]
    fn lzw_reads_strings_from_its_table() {
        // Clear, 0, 6 (= "0 0", the code being defined), 0, end: 0 0 0 0.
        let data = pack(2, &[4, 0, 6, 0, 5]);
        assert_eq!(lzw(2, &data, 4), vec![0, 0, 0, 0]);
        assert_eq!(deinterlace(&[0, 1, 2, 3, 4], 1, 5), vec![0, 3, 2, 4, 1]);
    }
}
