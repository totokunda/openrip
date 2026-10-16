//! Reader for AmazingEngine's binary "%SerializedFormat%", in which CapCut's effect bundles
//! keep their prefabs, materials and scenes (format notes: docs/parity/capcut-bundles.md).
//!
//! Every class, type and property is stored as the djb2 hash of its name. Names are
//! recovered from a list the caller knows ([`decode`]'s `names`); others come out as
//! `#xxxxxxxx`. Values become JSON: objects with an `"@class"` key, numbers, strings,
//! arrays (vectors and colours too), and `{"@ref": path}` for files in the bundle.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

const MAGIC: &[u8] = b"%SerializedFormat%@\n";

/// djb2 (h = h * 33 + byte, from 5381), as the format hashes names.
pub fn djb2(name: &str) -> u32 {
    name.bytes().fold(5381u32, |h, c| h.wrapping_mul(33).wrapping_add(c as u32))
}

/// The root objects of a %SerializedFormat% file, or `None` if it isn't one.
pub fn decode(bytes: &[u8], names: &[&str]) -> Option<Vec<Value>> {
    if !bytes.starts_with(MAGIC) {
        return None;
    }
    let names: HashMap<u32, &str> = names.iter().map(|n| (djb2(n), *n)).collect();
    let mut o = 0x40;
    let count = u32_at(bytes, o)?;
    o += 4;
    let mut out = Vec::new();
    for _ in 0..count {
        let (class, size) = (u32_at(bytes, o)?, u32_at(bytes, o + 4)? as usize);
        o += 8;
        let end = (o + size).min(bytes.len());
        // The root object starts at its class hash followed by the object kind.
        let mut at = o;
        while at + 8 <= end && (u32_at(bytes, at)?, u32_at(bytes, at + 4)?) != (class, OBJECT) {
            at += 4;
        }
        let mut r = Reader { b: &bytes[..end], o: at, names: &names, seen: vec![1] };
        out.push(r.value().unwrap_or(Value::Null));
        o = end;
    }
    Some(out)
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

// Value kinds: the u32 after each value's type hash.
const STRING: u32 = 0;
const INT32: u32 = 1;
const OBJECT: u32 = 2;
const INT64: u32 = 3;
const BOOL: u32 = 4;
const DOUBLE: u32 = 5;
const LOCAL_REF: u32 = 0x20;
const EXTERNAL_REF: u32 = 0x21;
const VECTOR: u32 = 0x22;
const MAP: u32 = 0x23;
const GUID: u32 = 0x24;
const STRING_VECTOR: u32 = 0x1F;
const BITSET: u32 = 0xB;

/// Float vectors of a fixed length: vec2/3/4, mat4, rect, colour, AABB.
fn floats_of(kind: u32) -> Option<usize> {
    Some(match kind {
        6 => 2,
        7 => 3,
        8 | 0xC | 0xD => 4,
        0xA => 16,
        0x10 => 6,
        _ => return None,
    })
}

/// Arrays with a count: element size in bytes.
fn array_of(kind: u32) -> Option<usize> {
    Some(match kind {
        0x15 => 1,
        0x12 | 0x16 => 2,
        0x17 | 0x18 => 4,
        0x1A => 8,
        _ => return None,
    })
}

struct Reader<'a> {
    b: &'a [u8],
    o: usize,
    names: &'a HashMap<u32, &'a str>,
    /// Object ids already written in full (1 is the root).
    seen: Vec<u32>,
}

impl Reader<'_> {
    fn u32(&mut self) -> Option<u32> {
        let v = u32_at(self.b, self.o)?;
        self.o += 4;
        Some(v)
    }

    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let v = self.b.get(self.o..self.o + n)?;
        self.o += n;
        Some(v)
    }

    fn string(&mut self, len: usize) -> Option<String> {
        Some(String::from_utf8_lossy(self.take(len)?).into_owned())
    }

    fn name(&self, h: u32) -> String {
        self.names.get(&h).map_or_else(|| format!("#{h:08x}"), |n| n.to_string())
    }

    fn value(&mut self) -> Option<Value> {
        let (ty, kind) = (self.u32()?, self.u32()?);
        if let Some(n) = floats_of(kind) {
            let v: Vec<f64> = (0..n).map(|_| self.take(4).map(|b| f32::from_le_bytes(b.try_into().unwrap()) as f64)).collect::<Option<_>>()?;
            return Some(json!(v));
        }
        if let Some(size) = array_of(kind) {
            let n = self.u32()? as usize;
            self.take(n * size)?;
            return Some(json!({ "@items": n }));
        }
        Some(match kind {
            STRING => {
                let n = self.u32()? as usize;
                Value::String(self.string(n)?)
            }
            INT32 => json!(i32::from_le_bytes(self.take(4)?.try_into().ok()?)),
            INT64 => json!(i64::from_le_bytes(self.take(8)?.try_into().ok()?)),
            BOOL => json!(self.take(1)?[0] != 0),
            DOUBLE => json!(f64::from_le_bytes(self.take(8)?.try_into().ok()?)),
            GUID => {
                self.take(16)?;
                Value::Null
            }
            OBJECT => {
                let mut obj = Map::new();
                obj.insert("@class".into(), Value::String(self.name(ty)));
                for _ in 0..self.u32()? {
                    let (key, size) = (self.u32()?, self.u32()? as usize);
                    let end = (self.o + size).min(self.b.len());
                    // Each property carries its size, so one we can't read costs only itself.
                    let mut sub = Reader { b: &self.b[..end], o: self.o, names: self.names, seen: std::mem::take(&mut self.seen) };
                    let v = sub.value().unwrap_or(Value::Null);
                    self.seen = sub.seen;
                    obj.insert(self.name(key), v);
                    self.o = end;
                }
                Value::Object(obj)
            }
            LOCAL_REF => {
                // An object id, followed by the object where it is first written in place;
                // objects kept elsewhere (or already written) are referenced by id alone.
                let id = self.u32()?;
                let inline = id != 0 && !self.seen.contains(&id) && self.b.len() >= self.o + 8 && u32_at(self.b, self.o + 4)? <= GUID;
                if !inline {
                    return Some(Value::Null);
                }
                self.seen.push(id);
                self.value()?
            }
            EXTERNAL_REF => {
                if self.u32()? == 0 {
                    return Some(Value::Null);
                }
                self.u32()?;
                self.u32()?;
                let n = self.u32()? as usize;
                let path = self.string(n)?;
                self.u32()?;
                json!({ "@ref": path })
            }
            VECTOR => {
                let n = self.u32()?;
                let mut out = Vec::new();
                for _ in 0..n {
                    if self.o >= self.b.len() {
                        break;
                    }
                    out.push(self.value()?);
                }
                Value::Array(out)
            }
            MAP => {
                let mut out = Map::new();
                for _ in 0..self.u32()? {
                    let n = u16::from_le_bytes(self.take(2)?.try_into().ok()?) as usize;
                    let key = self.string(n)?;
                    out.insert(key, self.value()?);
                }
                Value::Object(out)
            }
            STRING_VECTOR => {
                let n = self.u32()?;
                Value::Array((0..n).map(|_| self.u32().and_then(|l| self.string(l as usize)).map(Value::String)).collect::<Option<_>>()?)
            }
            BITSET => {
                let n = self.u32()? as usize;
                self.take(n * 4)?;
                Value::Null
            }
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_hash_as_capcut_stores_them() {
        assert_eq!(djb2("name"), 0x7c9b_0c46);
        assert_eq!(djb2("Material"), 0xcc4b_b974);
    }

    #[test]
    fn decodes_an_object_with_typed_properties() {
        // A "Layer" object: scale (double), offset (vec2), file reference, and a vector of
        // one inline object referenced by id.
        let mut b = MAGIC.to_vec();
        b.resize(0x40, 0);
        let mut obj = Vec::new();
        let put = |v: &mut Vec<u8>, x: u32| v.extend_from_slice(&x.to_le_bytes());
        let prop = |v: &mut Vec<u8>, key: &str, body: Vec<u8>| {
            v.extend_from_slice(&djb2(key).to_le_bytes());
            v.extend_from_slice(&(body.len() as u32).to_le_bytes());
            v.extend(body);
        };
        put(&mut obj, djb2("Layer"));
        put(&mut obj, OBJECT);
        put(&mut obj, 4);
        let mut d = Vec::new();
        put(&mut d, djb2("double"));
        put(&mut d, DOUBLE);
        d.extend_from_slice(&0.04f64.to_le_bytes());
        prop(&mut obj, "scale", d);
        let mut v2 = Vec::new();
        put(&mut v2, djb2("Vector2f"));
        put(&mut v2, 6);
        v2.extend_from_slice(&0.02f32.to_le_bytes());
        v2.extend_from_slice(&(-0.02f32).to_le_bytes());
        prop(&mut obj, "offset", v2);
        let mut r = Vec::new();
        put(&mut r, djb2("ExternalRef"));
        put(&mut r, EXTERNAL_REF);
        put(&mut r, 1);
        put(&mut r, djb2("Texture2D"));
        put(&mut r, 2);
        put(&mut r, 11);
        r.extend_from_slice(b"image/2.png");
        put(&mut r, 1);
        prop(&mut obj, "texture", r);
        let mut vec = Vec::new();
        put(&mut vec, djb2("Vector"));
        put(&mut vec, VECTOR);
        put(&mut vec, 1);
        put(&mut vec, djb2("LocalRef"));
        put(&mut vec, LOCAL_REF);
        put(&mut vec, 2);
        put(&mut vec, djb2("Child"));
        put(&mut vec, OBJECT);
        put(&mut vec, 0);
        prop(&mut obj, "children", vec);
        put(&mut b, 1);
        put(&mut b, djb2("Layer"));
        put(&mut b, obj.len() as u32);
        b.extend(obj);
        let out = decode(&b, &["Layer", "scale", "offset", "texture", "children", "Child"]).unwrap();
        let l = &out[0];
        assert_eq!(l["@class"], "Layer");
        assert_eq!(l["scale"], 0.04);
        assert!((l["offset"][1].as_f64().unwrap() + 0.02).abs() < 1e-6);
        assert_eq!(l["texture"]["@ref"], "image/2.png");
        assert_eq!(l["children"][0]["@class"], "Child");
        assert!(decode(b"not a bundle", &[]).is_none());
    }
}
