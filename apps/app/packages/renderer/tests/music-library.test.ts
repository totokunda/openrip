// Tests for the Audio tab's Music and Sound effects libraries: the licence filter and the
// Openverse request (packages/main/src/modules/musicLibraryCore.ts) and the credits text a CC BY
// attribution needs (src/lib/music-credits.ts, lib/credits.ts). `node --test tests/` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_LICENSES, Pacer, allowedHost, isAllowedLicense, licenseLink, searchKey, searchUrl, toTrack } from "../../main/src/modules/musicLibraryCore.ts";
import { creditOf, licenseLabel, needsCredit, sourceName } from "../src/lib/music-credits.ts";
import { collectCredits, creditLine, creditsText } from "../src/lib/credits.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "eab8a6e2-0ac8-4615-9e0d-ebde30523783",
  title: "Deep Whoosh #1",
  creator: "Kinoton",
  creator_url: "https://freesound.org/people/Kinoton",
  license: "cc0",
  license_version: "1.0",
  license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  foreign_landing_url: "https://freesound.org/people/Kinoton/sounds/351256",
  url: "https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3",
  source: "freesound",
  filetype: "mp3",
  duration: 3155,
  mature: false,
  thumbnail: null,
  ...over,
});

test("only CC0, Public Domain Mark and CC BY pass the licence filter", () => {
  assert.deepEqual([...ALLOWED_LICENSES], ["cc0", "pdm", "by"]);
  for (const ok of ["cc0", "pdm", "by", "BY", " cc0 "]) assert.equal(isAllowedLicense(ok), true, ok);
  // Non-commercial, no-derivatives, share-alike and anything unknown stay out.
  for (const no of ["by-nc", "by-nd", "by-sa", "by-nc-sa", "by-nc-nd", "sampling+", "nc-sampling+", "", "all-rights-reserved", null, undefined, 3]) {
    assert.equal(isAllowedLicense(no), false, String(no));
  }
});

test("a result is a track only under an allowed licence", () => {
  assert.equal(toTrack(raw(), "sfx")?.license, "cc0");
  assert.equal(toTrack(raw({ license: "by", license_version: "3.0" }), "music")?.licenseVersion, "3.0");
  assert.equal(toTrack(raw({ license: "pdm" }), "sfx")?.license, "pdm");
  for (const license of ["by-nc", "by-nd", "by-sa", "by-nc-sa"]) assert.equal(toTrack(raw({ license }), "music"), null, license);
});

test("a result without a file, a title, a length or a safe id, or a mature one, is no track", () => {
  assert.equal(toTrack(raw({ url: null }), "sfx"), null);
  assert.equal(toTrack(raw({ url: "javascript:alert(1)" }), "sfx"), null);
  assert.equal(toTrack(raw({ title: "  " }), "sfx"), null);
  assert.equal(toTrack(raw({ duration: 0 }), "sfx"), null);
  assert.equal(toTrack(raw({ duration: null }), "sfx"), null);
  assert.equal(toTrack(raw({ id: "../../etc/passwd" }), "sfx"), null);
  assert.equal(toTrack(raw({ mature: true }), "sfx"), null);
  assert.equal(toTrack(null, "sfx"), null);
});

test("a track keeps what a credit needs", () => {
  const t = toTrack(raw({ license: "by", license_version: "4.0", license_url: null }), "sfx")!;
  assert.equal(t.title, "Deep Whoosh #1");
  assert.equal(t.author, "Kinoton");
  assert.equal(t.authorUrl, "https://freesound.org/people/Kinoton");
  assert.equal(t.licenseUrl, "https://creativecommons.org/licenses/by/4.0/", "the deed when the API gives none");
  assert.equal(t.sourceUrl, "https://freesound.org/people/Kinoton/sounds/351256");
  assert.equal(t.durationSec, 3.155);
  assert.equal(t.ext, "mp3");
  assert.equal(toTrack(raw({ creator: null }), "sfx")!.author, "Unknown artist");
  assert.equal(toTrack(raw({ filetype: "mp32", url: "https://prod-1.storage.jamendo.com/?trackid=1&format=mp32" }), "music")!.ext, "mp3");
  assert.equal(licenseLink("cc0"), "https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(licenseLink("pdm"), "https://creativecommons.org/publicdomain/mark/1.0/");
});

test("the search asks Openverse for the three licences only, with an honest request", () => {
  const u = new URL(searchUrl("https://api.openverse.org", { kind: "music", q: " epic  ", page: 2 }));
  assert.equal(u.origin + u.pathname, "https://api.openverse.org/v1/audio/");
  assert.equal(u.searchParams.get("license"), "cc0,pdm,by");
  assert.equal(u.searchParams.get("category"), "music");
  assert.equal(u.searchParams.get("q"), "epic");
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("mature"), "false");
  const s = new URL(searchUrl("http://127.0.0.1:9/", { kind: "sfx", q: "whoosh", pageSize: 999 }));
  assert.equal(s.searchParams.get("source"), "freesound");
  assert.equal(s.searchParams.get("page_size"), "40");
  assert.equal(s.searchParams.get("category"), null);
  assert.equal(new URL(searchUrl("https://api.openverse.org", { kind: "music" })).searchParams.has("q"), false);
});

test("downloads come from the sources' hosts over https only", () => {
  assert.equal(allowedHost("https://cdn.freesound.org/previews/1/1.mp3"), true);
  assert.equal(allowedHost("https://prod-1.storage.jamendo.com/?trackid=1"), true);
  assert.equal(allowedHost("https://api.openverse.org/v1/audio/x/thumb/"), true);
  assert.equal(allowedHost("https://upload.wikimedia.org/a.ogg"), true);
  assert.equal(allowedHost("http://cdn.freesound.org/a.mp3"), false);
  assert.equal(allowedHost("https://evilfreesound.org/a.mp3"), false);
  assert.equal(allowedHost("https://example.com/a.mp3"), false);
  assert.equal(allowedHost("http://127.0.0.1:5000/a.mp3"), false);
  assert.equal(allowedHost("http://127.0.0.1:5000/a.mp3", "http://127.0.0.1:5000"), true, "the tests' fixture server");
});

test("a search's cache key follows what was asked, not how it was typed", () => {
  const a = searchKey({ kind: "music", q: "Epic  Trailer" });
  assert.equal(a, searchKey({ kind: "music", q: " epic trailer " }));
  assert.notEqual(a, searchKey({ kind: "sfx", q: "epic trailer" }));
  assert.notEqual(a, searchKey({ kind: "music", q: "epic trailer", page: 2 }));
  assert.match(a, /^[a-z0-9-]+$/);
});

test("requests are paced: a gap, a limit a minute, and a stop on a 429", async () => {
  let t = 0;
  const slept: number[] = [];
  const pacer = new Pacer(3, 1000, () => t, async (ms) => {
    slept.push(ms);
    t += ms;
  });
  const out: number[] = [];
  for (let i = 0; i < 4; i++) await pacer.run(async () => out.push(t));
  assert.deepEqual(out, [0, 1000, 2000, 60_000], "1 s apart, and the fourth waits for the minute");
  assert.equal(pacer.blockedFor(), 0);
  pacer.block(90);
  assert.equal(pacer.blockedFor(), 90_000);
  t += 91_000;
  assert.equal(pacer.blockedFor(), 0);
});

const credit = (over: Record<string, unknown> = {}) =>
  creditOf({
    ...(toTrack(raw({ license: "by", license_version: "3.0", license_url: "https://creativecommons.org/licenses/by/3.0/", title: "Funky Day", creator: "SoundForYou" }), "music")!),
    ...over,
  });

test("a CC BY track's credit has the title, the author, the licence and the links", () => {
  const c = credit();
  assert.equal(c.license, "CC BY 3.0");
  assert.equal(c.attributionRequired, true);
  assert.equal(c.kind, "music");
  assert.equal(c.sourceName, "Freesound");
  assert.equal(
    creditLine(c),
    '"Funky Day" by SoundForYou, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), via Freesound: https://freesound.org/people/Kinoton/sounds/351256',
  );
});

test("a CC0 or Public Domain track is listed and marked as needing no credit", () => {
  const c = creditOf(toTrack(raw(), "sfx")!);
  assert.equal(needsCredit({ license: "cc0" }), false);
  assert.equal(c.attributionRequired, false);
  assert.equal(c.kind, "sound");
  assert.equal(c.license, "CC0 1.0");
  assert.equal(licenseLabel({ license: "pdm" }), "Public Domain Mark");
  assert.equal(sourceName("wikimedia_audio"), "Wikimedia Audio");
});

test("the credits text has Music and Sound effects, and a project's credits are each track once", () => {
  const a = credit();
  const sfx = creditOf(toTrack(raw({ id: "99999999-2222-3333-4444-555555555555" }), "sfx")!);
  const credits = collectCredits({ x: { credit: a }, y: { credit: a }, z: {}, w: { credit: sfx } });
  assert.deepEqual(credits.map((c) => c.title), ["Funky Day", "Deep Whoosh #1"]);
  const lines = creditsText(credits).split("\n");
  assert.equal(lines[0], "Music:");
  assert.match(lines[1], /^- "Funky Day" by SoundForYou/);
  assert.equal(lines[3], "Sound effects:");
  assert.match(lines[4], /^- "Deep Whoosh #1".*CC0 1\.0/);
});
