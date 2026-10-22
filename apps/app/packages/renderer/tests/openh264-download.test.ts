// Tests for packages/main/src/modules/openh264Download.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadOpenh264, openh264Blocked, type OpenH264Info } from "../../main/src/modules/openh264Download.ts";

const body = Buffer.from("BZh9 Cisco's OpenH264, more or less");
const sha256 = createHash("sha256").update(body).digest("hex");
const info = (patch: Partial<OpenH264Info> = {}): OpenH264Info => ({
  supported: true,
  enabled: true,
  installed: false,
  version: "2.6.0",
  url: "https://ciscobinary.openh264.org/libopenh264-2.6.0-mac-arm64.dylib.bz2",
  sha256,
  error: null,
  attribution: "OpenH264 Video Codec provided by Cisco Systems, Inc.",
  ...patch,
});

/** A server answering `bytes` in two parts, and the URLs it was asked for. */
const server = (bytes: Buffer, status = 200) => {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.subarray(0, 10));
        c.enqueue(bytes.subarray(10));
        c.close();
      },
    });
    return new Response(stream, { status, headers: { "content-length": String(bytes.length) } });
  };
  return { fetch, asked };
};

test("Cisco's binary is downloaded from Cisco with its progress, and kept when its SHA-256 is the pinned one", async () => {
  const { fetch, asked } = server(body);
  const progress: [number, number][] = [];
  const data = await downloadOpenh264(info(), fetch, (r, t) => progress.push([r, t]));
  assert.deepEqual(data, body);
  assert.deepEqual(asked, [info().url]);
  assert.deepEqual(progress, [
    [10, body.length],
    [body.length, body.length],
  ]);
});

test("a download that isn't the pinned file is refused", async () => {
  const { fetch } = server(Buffer.from("something else"));
  await assert.rejects(downloadOpenh264(info(), fetch, () => {}), /checksum doesn't match/);
});

test("offline or a server error: the dialog is told to check the connection", async () => {
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(downloadOpenh264(info(), offline, () => {}), /Couldn't download the OpenH264 codec from Cisco \(fetch failed\)/);
  await assert.rejects(downloadOpenh264(info(), server(body, 404).fetch, () => {}), /answered 404/);
});

test("nothing is fetched when OpenH264 is turned off, not made for this computer, or not on Cisco's server", async () => {
  const { fetch, asked } = server(body);
  assert.match(openh264Blocked(info({ enabled: false }))!, /turned off in Settings/);
  assert.match(openh264Blocked(info({ supported: false, url: null, sha256: null }))!, /isn't made for this computer/);
  assert.match(openh264Blocked(null)!, /isn't made for this computer/);
  assert.equal(openh264Blocked(info()), null);
  await assert.rejects(downloadOpenh264(info({ url: "https://example.com/libopenh264.dylib.bz2" }), fetch, () => {}), /only be downloaded from Cisco/);
  assert.deepEqual(asked, []);
});

test("a cancelled download says so", async () => {
  const abort = new AbortController();
  const fetch = async () => {
    abort.abort();
    throw new DOMException("aborted", "AbortError");
  };
  await assert.rejects(downloadOpenh264(info(), fetch, () => {}, abort.signal), /^Error: cancelled$/);
});
