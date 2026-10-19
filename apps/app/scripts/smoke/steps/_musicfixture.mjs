// A local stand-in for Openverse, for the `musiclib` step (OPENRIP_OPENVERSE_BASE points the
// app's main process here): `/v1/audio/` answers searches in Openverse's shape, and /files/<n>.wav
// serves a tone per track. The results include licences the app must refuse (BY-SA, BY-NC, ND), so
// the step can check they never show. `server.stop()` closes it (the app is then "offline");
// `server.log` has every request with its User-Agent.
import http from "node:http";

/** A mono 16-bit WAV: `hz` for `seconds`, with a short fade at each end. */
export const toneWav = (hz, seconds, rate = 22050) => {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.6 * fade * 32767), 44 + i * 2);
  }
  return buf;
};

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// kind, id, title, creator, license, version, hz, seconds, tags
const TRACKS = [
  ["music", 1, "Sunrise Anthem", "Fixture Artist", "by", "3.0", 523, 6, ["trending", "happy"]],
  ["music", 2, "Quiet Hours", "Public Domain Pat", "cc0", "1.0", 659, 5, ["trending", "chill"]],
  ["music", 3, "Epic Journey", "Orchestra Fixture", "by", "4.0", 587, 7, ["epic"]],
  ["music", 4, "Share Alike Song", "SA Band", "by-sa", "4.0", 330, 4, ["trending", "epic"]],
  ["music", 5, "Non Commercial Tune", "NC Band", "by-nc", "4.0", 349, 4, ["trending", "epic"]],
  ["music", 6, "No Derivs Piece", "ND Band", "by-nd", "4.0", 392, 4, ["trending", "epic"]],
  ["sfx", 11, "Big Whoosh", "Whoosh Maker", "cc0", "1.0", 1240, 1.5, ["trending", "whoosh"]],
  ["sfx", 12, "Mouse Click", "Click Co", "by", "4.0", 1760, 1, ["trending", "click"]],
  ["sfx", 13, "Crowd Applause", "Clap Studio", "pdm", "1.0", 1480, 2, ["applause"]],
  ["sfx", 14, "Rights Reserved Boom", "Boom Inc", "by-nc-sa", "3.0", 200, 2, ["trending", "whoosh"]],
];

const rawOf = ([kind, n, title, creator, license, version, hz, seconds], base) => ({
  id: id(n),
  title,
  creator,
  creator_url: `${base}/people/${encodeURIComponent(creator)}`,
  license,
  license_version: version,
  license_url: `https://creativecommons.org/licenses/${license}/${version}/`,
  foreign_landing_url: `${base}/${kind}/${n}`,
  url: `${base}/files/${n}.wav`,
  source: kind === "sfx" ? "freesound" : "jamendo",
  provider: kind === "sfx" ? "freesound" : "jamendo",
  filetype: "wav",
  duration: Math.round(seconds * 1000),
  mature: false,
  thumbnail: null,
});

export const startFixture = async () => {
  const log = [];
  const sockets = new Set();
  const delayMs = { files: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    log.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), ua: req.headers["user-agent"] ?? "", range: req.headers.range ?? "" });
    const base = `http://127.0.0.1:${server.address().port}`;
    if (u.pathname === "/v1/audio/") {
      const kind = u.searchParams.get("category") === "music" ? "music" : "sfx";
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      // The real API honours `license`; this one leaks the others on purpose (the app filters again).
      const found = TRACKS.filter((t) => t[0] === kind && (!q || t[8].includes(q) || (q === "sound effect" && t[8].includes("trending")) || t[2].toLowerCase().includes(q)));
      const page = TRACKS.length ? Number(u.searchParams.get("page") ?? 1) : 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result_count: found.length, page_count: 1, page_size: 20, page, results: page === 1 ? found.map((t) => rawOf(t, base)) : [] }));
      return;
    }
    const m = /^\/files\/(\d+)\.wav$/.exec(u.pathname);
    if (m) {
      const t = TRACKS.find((x) => x[1] === Number(m[1]));
      if (!t) {
        res.statusCode = 404;
        res.end();
        return;
      }
      setTimeout(() => {
        res.setHeader("content-type", "audio/wav");
        res.end(toneWav(t[6], t[7]));
      }, delayMs.files);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    log,
    delayMs,
    tracks: TRACKS.map((t) => ({ kind: t[0], id: id(t[1]), title: t[2], creator: t[3], license: t[4], hz: t[6], seconds: t[7] })),
    stop: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
};
