// Cisco's OpenH264, fetched the first time an export needs H.264 in software (EngineModule's
// engine:export). Cisco pays the H.264 patent fees for its own binary only when it is downloaded
// separately to the user's machine (https://www.openh264.org/BINARY_LICENSE.txt), so it comes
// from Cisco's server and nowhere else, is checked against the SHA-256 the engine pins for this
// platform, and is then handed to the engine, which checks it again and keeps it in the user
// data. No Electron here: tested in plain Node (renderer/tests/openh264-download.test.ts).
import { createHash } from "node:crypto";

/** The engine's `openh264Info()`. */
export type OpenH264Info = {
  supported: boolean;
  enabled: boolean;
  installed: boolean;
  version: string;
  url: string | null;
  sha256: string | null;
  error: string | null;
  attribution: string;
};

/** The only server the binary is taken from. */
export const CISCO_HOST = "ciscobinary.openh264.org";

/** Why an export can't fetch OpenH264, in words for the Export dialog; null when it can. */
export function openh264Blocked(info: OpenH264Info | null | undefined): string | null {
  if (!info?.supported || !info.url || !info.sha256) return "H.264 without hardware encoding needs Cisco's OpenH264, which isn't made for this computer.";
  if (!info.enabled) return "H.264 without hardware encoding needs the OpenH264 codec, which is turned off in Settings › Performance.";
  if (new URL(info.url).hostname !== CISCO_HOST) return "OpenH264 can only be downloaded from Cisco's server.";
  return null;
}

/**
 * Download Cisco's binary (`info.url`) with `fetch`, telling `onProgress` the bytes received and
 * the total (0 when unknown), and check its SHA-256. Rejects, in words for the dialog, when the
 * download fails or isn't the expected file.
 */
export async function downloadOpenh264(info: OpenH264Info, fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>, onProgress: (received: number, total: number) => void, signal?: AbortSignal): Promise<Buffer> {
  const blocked = openh264Blocked(info);
  if (blocked) throw new Error(blocked);
  let data: Buffer;
  try {
    const res = await fetch(info.url!, { signal });
    if (!res.ok || !res.body) throw new Error(`Cisco's server answered ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received, total);
    }
    data = Buffer.concat(chunks);
  } catch (e) {
    if (signal?.aborted) throw new Error("cancelled");
    throw new Error(`Couldn't download the OpenH264 codec from Cisco (${e instanceof Error ? e.message : String(e)}). Check the internet connection and try again.`);
  }
  if (createHash("sha256").update(data).digest("hex") !== info.sha256) throw new Error("The file downloaded from Cisco isn't the OpenH264 codec OpenRip expects (its checksum doesn't match), so it wasn't used.");
  return data;
}
