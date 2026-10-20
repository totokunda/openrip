// Tests for the Filters tab's look groups and tile maths (src/lib/filters/looks.ts, lut.ts): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, FEATURED, groupOf, isIdentity, lookOf, lookSections, LOOK_GROUPS, PHOTOS } from "../src/lib/filters/looks.ts";
import { applyHald, haldLevel } from "../src/lib/filters/lut.ts";

const at = (rel: string) => lookOf(rel.split("/").pop()!, `/app/filters/small/${rel}.png`);

test("filters are grouped by look, not by film brand", () => {
  assert.equal(at("film_simulation/color/kodak/kodak_portra_400_2").group, "Portrait");
  assert.equal(at("film_simulation/color/fuji/fuji_velvia_50").group, "Landscape");
  assert.equal(at("film_simulation/black_and_white/ilford/ilford_hp5_2").group, "Mono");
  assert.equal(at("pixelmator_pro/mono").group, "Mono");
  assert.equal(at("film_simulation/color/polaroid/polaroid_690_3").group, "Retro");
  assert.equal(at("film_simulation/color/creativepack-1/tealorange1").group, "Movies");
  assert.equal(at("film_simulation/color/creativepack-1/moonlight").group, "Night");
  assert.equal(at("picturefx/goldfx/goldfx-perfect-sunset-05min").group, "Sunset");
  assert.equal(at("film_simulation/color/kodak/kodak_elite_color_200").group, "Food");
  assert.equal(at("film_simulation/color/fuji/fuji_superia_400_2").group, "Life");
  assert.equal(groupOf("fuji_superia_1600_2", "film_simulation/color/fuji"), "Night");
});

test("every group is a Filters column item and Featured comes first", () => {
  assert.equal(LOOK_GROUPS[0], "Featured");
  const col = lookSections(["Mono", "Portrait", "Nope"]);
  assert.deepEqual(col.map((c) => c.label), ["Featured", "Portrait", "Mono"]);
  assert.ok(col.every((c) => c.under === "Filters" && c.id === `cat:${c.label}`));
});

test("names are clean: variants read as strength, brands of the OS tables are dropped", () => {
  assert.equal(cleanName("kodak_portra_400_3_+"), "Kodak Portra 400 3+");
  assert.equal(cleanName("kodak_portra_400_nc_2"), "Kodak Portra 400 NC 2");
  assert.equal(cleanName("fuji_fp-3000b_1_--"), "Fuji FP-3000B 1--");
  assert.equal(cleanName("apple_intense_cold"), "Intense Cold");
  assert.equal(cleanName("tealorange2"), "Teal Orange 2");
  assert.equal(cleanName("goldfx-perfect-sunset-05min"), "Perfect Sunset 5 min");
  assert.equal(cleanName("fuji_xtrans_iii_-_classic_chrome"), "X-Trans III Classic Chrome");
  assert.equal(cleanName("kodak_tri-x_400_4_+"), "Kodak Tri-X 400 4+");
});

test("a family's variants share one example photo, and every photo is a bundled one", () => {
  const a = at("film_simulation/color/kodak/kodak_portra_400_1_-");
  const b = at("film_simulation/color/kodak/kodak_portra_400_4_++");
  assert.equal(a.photo, b.photo);
  for (const id of ["apple_black", "kodak_ektar_100", "fuji_provia_400x", "polaroid_px-70_6_+++", "moonlight"]) assert.ok((PHOTOS as readonly string[]).includes(lookOf(id, "x").photo), id);
});

test("featured filters are ranked in order, others are not", () => {
  assert.equal(lookOf(FEATURED[0], "x").featured, 0);
  assert.equal(lookOf(FEATURED[5], "x").featured, 5);
  assert.equal(lookOf("polaroid_669_2_-", "x").featured, -1);
});

test("the identity table is left out", () => {
  assert.ok(isIdentity("hald_clut_identity_12"));
  assert.ok(!isIdentity("kodak_ektar_100"));
});

/** A Hald table of level 2 (side 8, 4 values a channel) with each entry mapped by `f`. */
const table = (f: (r: number, g: number, b: number) => number[]) => {
  const n = 4;
  const d = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 64; i++) {
    const [r, g, b] = [i % n, Math.floor(i / n) % n, Math.floor(i / (n * n))].map((v) => v / (n - 1));
    const o = f(r, g, b);
    d.set([o[0] * 255, o[1] * 255, o[2] * 255, 255], i * 4);
  }
  return d;
};

test("the Hald level comes from the image side", () => {
  assert.equal(haldLevel(512), 8);
  assert.equal(haldLevel(1728), 12);
  assert.equal(haldLevel(8), 2);
});

test("an identity table leaves the picture alone; an inverting one inverts it; strength mixes", () => {
  const src = new Uint8ClampedArray([10, 100, 200, 255, 255, 0, 128, 255]);
  const same = applyHald(src, table((r, g, b) => [r, g, b]), 8, 8);
  src.forEach((v, i) => assert.ok(Math.abs(v - same[i]) <= 1, `identity ${i}`));
  const inv = applyHald(src, table((r, g, b) => [1 - r, 1 - g, 1 - b]), 8, 8);
  [245, 155, 55, 255, 0, 255, 127, 255].forEach((v, i) => assert.ok(Math.abs(v - inv[i]) <= 2, `invert ${i}: ${inv[i]} vs ${v}`));
  const half = applyHald(src, table((r, g, b) => [1 - r, 1 - g, 1 - b]), 8, 8, 0.5);
  assert.ok(Math.abs(half[0] - (10 + 245) / 2) <= 2);
  assert.equal(half[3], 255);
});
