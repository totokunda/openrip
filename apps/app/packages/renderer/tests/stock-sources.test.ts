// Tests for src/lib/stock/sources.ts: `node --test tests/` in packages/renderer. Which stock
// files may be used (the licence filters) and how each source's answer becomes a tile.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commonsLicence,
  htmlLink,
  htmlText,
  interleave,
  nasaPick,
  normalizeCommons,
  normalizeNasa,
  normalizeOpenverse,
  openverseLicence,
  stockId,
  thumbAt,
} from "../src/lib/stock/sources.ts";

test("Commons: CC0, public domain and CC BY (any version) pass", () => {
  for (const name of ["CC0", "CC0 1.0", "Public domain", "PD-old-70", "PD-USGov-NASA", "PDM 1.0", "CC BY 4.0", "CC BY 2.0", "CC BY 3.0 de", "CC BY 2.5 AU"]) {
    assert.ok(commonsLicence(name), name);
  }
  assert.equal(commonsLicence("CC BY 4.0")?.attribution, true);
  assert.equal(commonsLicence("CC0")?.attribution, false);
  assert.equal(commonsLicence("Public domain")?.attribution, false);
  assert.equal(commonsLicence("CC BY 4.0")?.name, "CC BY 4.0");
  assert.equal(commonsLicence("CC BY 3.0 de")?.name, "CC BY 3.0 de");
});

test("Commons: Share-Alike, NonCommercial, NoDerivatives, GFDL, fair use and unknown licences are out", () => {
  for (const name of ["CC BY-SA 4.0", "CC BY-SA 3.0", "CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "GFDL", "GFDL 1.2", "Fair use", "Copyrighted free use", "", "Attribution", "FAL", "GPL"]) {
    assert.equal(commonsLicence(name), null, name);
  }
  assert.equal(commonsLicence(undefined), null);
});

test("Commons: the licence's own address is kept, https and without its /deed language", () => {
  assert.equal(commonsLicence("CC BY 4.0", "http://creativecommons.org/licenses/by/4.0/deed.en")?.url, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(commonsLicence("CC BY 3.0")?.url, "https://creativecommons.org/licenses/by/3.0/");
  assert.equal(commonsLicence("CC0")?.url, "https://creativecommons.org/publicdomain/zero/1.0/");
});

test("Openverse: cc0, pdm and by only", () => {
  assert.equal(openverseLicence("cc0")?.name, "CC0");
  assert.equal(openverseLicence("pdm")?.name, "Public domain");
  assert.deepEqual(openverseLicence("by", "2.0"), { name: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/", attribution: true });
  for (const code of ["by-sa", "by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "sampling+", "nc-sampling+", "", undefined]) assert.equal(openverseLicence(code as string), null, String(code));
});

const openverse = (over: object = {}) => ({
  id: "9f88306f-a2c2-41d8-885f-74d3d06607d4",
  title: "Hallet Peak",
  creator: "Dusty J",
  creator_url: "https://www.flickr.com/photos/55608722@N06",
  license: "by",
  license_version: "2.0",
  license_url: "https://creativecommons.org/licenses/by/2.0/",
  url: "https://live.staticflickr.com/6223/6314607981_eba7a3989a_b.jpg",
  thumbnail: "https://api.openverse.org/v1/images/9f88306f/thumb/",
  foreign_landing_url: "https://www.flickr.com/photos/55608722@N06/6314607981",
  width: 1024,
  height: 733,
  mature: false,
  ...over,
});

test("Openverse: a result becomes a tile that keeps its author, licence and source", () => {
  const t = normalizeOpenverse(openverse())!;
  assert.equal(t.kind, "photo");
  assert.equal(t.source, "openverse");
  assert.equal(t.author, "Dusty J");
  assert.equal(t.license, "CC BY 2.0");
  assert.equal(t.attributionRequired, true);
  assert.equal(t.sourceUrl, "https://www.flickr.com/photos/55608722@N06/6314607981");
  assert.match(t.id, /^openverse-[a-z0-9]+$/);
});

test("Openverse: a result with a non-free licence, flagged mature or sensitive, or without a file is dropped", () => {
  assert.equal(normalizeOpenverse(openverse({ license: "by-nc" })), null);
  assert.equal(normalizeOpenverse(openverse({ license: "by-sa" })), null);
  assert.equal(normalizeOpenverse(openverse({ mature: true })), null);
  assert.equal(normalizeOpenverse(openverse({ unstable__sensitivity: ["sensitive_text"] })), null);
  assert.equal(normalizeOpenverse(openverse({ url: undefined })), null);
  assert.equal(normalizeOpenverse(null), null);
});

const commonsPage = (over: { meta?: Record<string, string>; ii?: object; title?: string } = {}) => ({
  title: over.title ?? "File:Waterfall in Huascarán.webm",
  imageinfo: [
    {
      mime: "video/webm",
      width: 1080,
      height: 1920,
      size: 5_000_000,
      url: "https://upload.wikimedia.org/wikipedia/commons/f/f7/Waterfall.webm",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Waterfall_in_Huascar%C3%A1n.webm",
      thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Waterfall.webm/330px--Waterfall.webm.jpg",
      metadata: [{ name: "playtime_seconds", value: 31.8 }],
      derivatives: [],
      extmetadata: {
        ObjectName: { value: "Waterfall in Huascarán" },
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:CorraleH" title="User:CorraleH">CorraleH</a>' },
        Credit: { value: '<span class="int-own-work">Own work</span>' },
        LicenseShortName: { value: "CC0" },
        LicenseUrl: { value: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
        Restrictions: { value: "" },
        ...Object.fromEntries(Object.entries(over.meta ?? {}).map(([k, v]) => [k, { value: v }])),
      },
      ...over.ii,
    },
  ],
});

test("Commons: a video becomes a tile with its length, author link, licence and page", () => {
  const t = normalizeCommons(commonsPage(), "video")!;
  assert.equal(t.kind, "video");
  assert.equal(t.title, "Waterfall in Huascarán");
  assert.equal(t.author, "CorraleH");
  assert.equal(t.authorUrl, "https://commons.wikimedia.org/wiki/User:CorraleH");
  assert.equal(t.license, "CC0");
  assert.equal(t.attributionRequired, false);
  assert.equal(Math.round(t.duration!), 32);
  assert.equal(t.sourceUrl, "https://commons.wikimedia.org/wiki/File:Waterfall_in_Huascar%C3%A1n.webm");
  assert.equal(t.preview, t.url);
});

test("Commons: Share-Alike and files with Restrictions are dropped", () => {
  assert.equal(normalizeCommons(commonsPage({ meta: { LicenseShortName: "CC BY-SA 4.0" } }), "video"), null);
  assert.equal(normalizeCommons(commonsPage({ meta: { Restrictions: "personality" } }), "video"), null);
  assert.equal(normalizeCommons(commonsPage({ meta: { LicenseShortName: "CC BY 4.0" } }), "video")!.attributionRequired, true);
});

test("Commons: only webm and mp4 videos, only jpeg, png and webp photos", () => {
  assert.equal(normalizeCommons(commonsPage({ ii: { mime: "video/ogg" } }), "video"), null);
  assert.equal(normalizeCommons(commonsPage({ ii: { mime: "image/gif" } }), "photo"), null);
  assert.equal(normalizeCommons(commonsPage({ ii: { mime: "image/svg+xml" } }), "photo"), null);
  assert.ok(normalizeCommons(commonsPage({ ii: { mime: "image/jpeg" } }), "photo"));
  // A video asked for as a photo isn't one.
  assert.equal(normalizeCommons(commonsPage(), "photo"), null);
});

test("Commons: a huge video is dropped unless a smaller rendering exists, and a big photo is fetched at 1920 px", () => {
  assert.equal(normalizeCommons(commonsPage({ ii: { size: 500_000_000 } }), "video"), null);
  const alt = { src: "https://upload.wikimedia.org/transcoded/x.webm/x.webm.720p.vp9.webm", type: 'video/webm; codecs="vp9"', width: 1280, height: 720 };
  const t = normalizeCommons(commonsPage({ ii: { size: 500_000_000, derivatives: [alt] } }), "video")!;
  assert.equal(t.url, alt.src);
  const photo = normalizeCommons(commonsPage({ ii: { mime: "image/jpeg", width: 6000, height: 4000, size: 9_000_000 } }), "photo")!;
  assert.match(photo.url, /\/1920px-/);
  const small = normalizeCommons(commonsPage({ ii: { mime: "image/jpeg", width: 1600, height: 900, size: 900_000 } }), "photo")!;
  assert.equal(small.url, "https://upload.wikimedia.org/wikipedia/commons/f/f7/Waterfall.webm");
});

test("Commons: with no Artist the Credit names the author, and 'Own work' alone is no name", () => {
  assert.equal(normalizeCommons(commonsPage({ meta: { Artist: "", Credit: "Some Agency" } }), "video")!.author, "Some Agency");
  assert.equal(normalizeCommons(commonsPage({ meta: { Artist: "", Credit: "Own work" } }), "video")!.author, "Unknown author");
});

test("NASA: a result is a tile under NASA's guidelines, its file found when downloaded", () => {
  const item = {
    data: [{ nasa_id: "GSFC_20140421_EarthOrbit_m11525", title: "Earth from Orbit 2013", media_type: "video", secondary_creator: "Jefferson Beck" }],
    links: [{ href: "http://images-assets.nasa.gov/video/x/x~thumb.jpg", rel: "preview", render: "image" }],
  };
  const t = normalizeNasa(item, "video")!;
  assert.equal(t.license, "NASA (public domain)");
  assert.equal(t.attributionRequired, false);
  assert.equal(t.author, "Jefferson Beck / NASA");
  assert.equal(t.url, "nasa-asset:GSFC_20140421_EarthOrbit_m11525");
  assert.equal(t.thumb, "https://images-assets.nasa.gov/video/x/x~thumb.jpg");
  assert.equal(normalizeNasa(item, "photo"), null);
  assert.deepEqual(
    nasaPick(["http://a/x~orig.mov", "http://a/x~mobile.mp4", "http://a/x~medium.mp4", "http://a/x.vtt"], "video"),
    "https://a/x~medium.mp4",
  );
  assert.equal(nasaPick(["http://a/x.vtt"], "video"), null);
  assert.equal(nasaPick(["http://a/x~large.jpg", "http://a/x~orig.jpg"], "photo"), "https://a/x~orig.jpg");
});

test("helpers: HTML to text and its first link, stable ids, thumbnail widths, interleaving", () => {
  assert.equal(htmlText('<a href="x">Ana &amp; Bo</a> &#169; 2020'), "Ana & Bo © 2020");
  assert.equal(htmlLink('<a href="//commons.wikimedia.org/wiki/User:A">A</a>'), "https://commons.wikimedia.org/wiki/User:A");
  assert.equal(htmlLink("plain"), undefined);
  assert.equal(stockId("commons", "File:A.webm"), stockId("commons", "File:A.webm"));
  assert.notEqual(stockId("commons", "File:A.webm"), stockId("commons", "File:B.webm"));
  assert.equal(thumbAt("https://u/thumb/a/ab/F.jpg/330px-F.jpg", 1920), "https://u/thumb/a/ab/F.jpg/1920px-F.jpg");
  assert.deepEqual(interleave([[1, 2, 3], ["a"], ["x", "y"]]), [1, "a", "x", 2, "y", 3]);
});
