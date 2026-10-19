// A local server standing in for the stock Library's three services (OPENRIP_STOCK_MIRROR): the
// Wikimedia Commons API (`/commons/w/api.php`), Openverse (`/openverse/v1/images/`) and the NASA
// Image and Video Library (`/nasa/search`, `/nasa/asset/<id>`), and the files they point to
// (`/files/…`: real WebM, MP4 and JPEG made with ffmpeg, after a short wait so a spinner shows).
// Each service also answers with files it must not offer (Share-Alike, NonCommercial, a
// Restrictions note, a mature picture), which the app should leave out.
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ffmpeg } from "./_audio.mjs";

export const makeMedia = (dir, fs) => {
  fs.mkdirSync(dir, { recursive: true });
  const make = (name, args) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) execFileSync(ffmpeg, ["-v", "error", "-y", ...args, file]);
    return file;
  };
  const lav = (src, n) => ["-f", "lavfi", "-t", "2", "-i", `${src}=size=${n}:rate=24`];
  make("v1.webm", [...lav("testsrc2", "320x180"), "-c:v", "libvpx", "-b:v", "300k", "-pix_fmt", "yuv420p"]);
  make("v2.webm", [...lav("smptebars", "320x180"), "-c:v", "libvpx", "-b:v", "300k", "-pix_fmt", "yuv420p"]);
  make("n1~medium.mp4", [...lav("mandelbrot", "320x180"), "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  const still = (name, src) => make(name, ["-f", "lavfi", "-i", `${src}=size=640x360`, "-frames:v", "1"]);
  still("p1.jpg", "testsrc");
  still("p2.jpg", "smptehdbars");
  still("p3.jpg", "mandelbrot");
  still("p3~orig.jpg", "mandelbrot");
  still("th.jpg", "testsrc2");
  still("o1.jpg", "testsrc");
  still("o2.jpg", "smptebars");
  return dir;
};

export const fixtureServer = async (mediaDir, fs, { port = 0 } = {}) => {
  const hits = [];
  const agents = [];
  let base = "";
  const file = (name) => `${base}/files/${name}`;
  const cc = (short, url) => ({ LicenseShortName: { value: short }, LicenseUrl: { value: url }, Restrictions: { value: "" } });
  const page = (title, i, mime, ext, meta, extra = {}) => ({
    pageid: i,
    title,
    index: i,
    imageinfo: [
      {
        mime,
        width: 320,
        height: 180,
        size: 90_000,
        url: file(`${ext}`),
        descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace("%3A", ":")}`,
        thumburl: file("th.jpg"),
        metadata: [{ name: "playtime_seconds", value: 2 }],
        derivatives: [],
        extmetadata: {
          ObjectName: { value: title.replace(/^File:/, "").replace(/\.\w+$/, "") },
          Artist: { value: `<a href="//commons.wikimedia.org/wiki/User:Fixture${i}" title="User:Fixture${i}">Fixture Author ${i}</a>` },
          Credit: { value: "Own work" },
          ...meta,
          ...extra.meta,
        },
        ...extra.ii,
      },
    ],
  });
  const commons = (q, kind, offset) => {
    if (/zzempty/.test(q) || offset > 0) return { batchcomplete: true, query: { pages: [] } };
    const video = kind === "video";
    const ext = video ? ["v1.webm", "v2.webm", "v1.webm", "v2.webm"] : ["p1.jpg", "p2.jpg", "p3.jpg", "p1.jpg"];
    const mime = video ? "video/webm" : "image/jpeg";
    const dot = video ? "webm" : "jpg";
    const pages = [
      page(`File:Fixture ${q} one.${dot}`, 1, mime, ext[0], cc("CC0", "http://creativecommons.org/publicdomain/zero/1.0/deed.en")),
      page(`File:Fixture ${q} two.${dot}`, 2, mime, ext[1], cc("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0")),
      page(`File:Fixture ${q} sharealike.${dot}`, 3, mime, ext[2], cc("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0")),
      page(`File:Fixture ${q} restricted.${dot}`, 4, mime, ext[3], { ...cc("CC0", ""), Restrictions: { value: "personality" } }),
    ];
    return { batchcomplete: true, continue: { gsroffset: 24, continue: "gsroffset||" }, query: { pages } };
  };
  const openverse = (q) => {
    if (/zzempty/.test(q)) return { result_count: 0, page_count: 0, page_size: 20, page: 1, results: [] };
    const r = (n, license, over = {}) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      title: `Fixture ${q} photo ${n}`,
      creator: `Photographer ${n}`,
      creator_url: `https://www.flickr.com/photos/fixture${n}`,
      license,
      license_version: "2.0",
      license_url: `https://creativecommons.org/licenses/${license}/2.0/`,
      url: file(`o${((n - 1) % 2) + 1}.jpg`),
      thumbnail: file("th.jpg"),
      foreign_landing_url: `https://www.flickr.com/photos/fixture${n}/${n}`,
      width: 640,
      height: 360,
      mature: false,
      ...over,
    });
    const results = [r(1, "by"), r(2, "cc0", { license_url: "https://creativecommons.org/publicdomain/zero/1.0/" }), r(3, "by-nc"), r(4, "by-sa"), r(5, "by", { mature: true })];
    return { result_count: results.length, page_count: 1, page_size: 20, page: 1, results };
  };
  const nasa = (q, type) => {
    if (/zzempty/.test(q)) return { collection: { items: [], links: [] } };
    const id = type === "video" ? "FIXTURE_VIDEO_1" : "FIXTURE_IMAGE_1";
    return { collection: { items: [{ href: `${base}/nasa/${id}/collection.json`, data: [{ nasa_id: id, title: `Fixture ${q} NASA ${type}`, media_type: type, secondary_creator: "Fixture NASA Team" }], links: [{ href: file("th.jpg"), rel: "preview", render: "image" }] }], links: [] } };
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    hits.push(req.url);
    agents.push([u.pathname, req.headers["user-agent"] ?? ""]);
    const json = (o) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (u.pathname === "/commons/w/api.php") {
      const gs = u.searchParams.get("gsrsearch") ?? "";
      const kind = /filetype:video/.test(gs) ? "video" : "photo";
      return json(commons(gs.replace(/ filetype:\w+$/, ""), kind, Number(u.searchParams.get("gsroffset") ?? 0)));
    }
    if (u.pathname === "/openverse/v1/images/") return json(openverse(u.searchParams.get("q") ?? ""));
    if (u.pathname === "/nasa/search") return json(nasa(u.searchParams.get("q") ?? "", u.searchParams.get("media_type") ?? "video"));
    if (u.pathname.startsWith("/nasa/asset/")) {
      const id = decodeURIComponent(u.pathname.slice("/nasa/asset/".length));
      const video = /VIDEO/.test(id);
      return json({ collection: { items: video ? [{ href: file("n1~orig.mov") }, { href: file("n1~medium.mp4") }] : [{ href: file("p3~orig.jpg") }] } });
    }
    if (u.pathname.startsWith("/files/")) {
      const name = path.basename(u.pathname);
      const full = path.join(mediaDir, name);
      if (!fs.existsSync(full)) {
        res.writeHead(404);
        return res.end();
      }
      const type = name.endsWith(".webm") ? "video/webm" : name.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
      // The pictures for the tiles come at once; the files being downloaded after a pause.
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": type, "Content-Length": fs.statSync(full).size, "Accept-Ranges": "none" });
        res.end(fs.readFileSync(full));
      }, name.startsWith("th") ? 0 : 900);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const start = async () => {
    await new Promise((r) => server.listen(port, "127.0.0.1", r));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  };
  await start();
  return {
    get url() {
      return base;
    },
    hits,
    agents,
    stop: () => {
      server.closeAllConnections?.();
      return new Promise((r) => server.close(r));
    },
    restart: async () => {
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
    },
  };
};
