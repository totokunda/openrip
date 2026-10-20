// How the Filters tab groups the LUT filters, as CapCut's column does: by what the look is for
// (Portrait, Landscape, Movies, Retro, Mono, Night, Food...), with a Featured set first. The
// library on disk is grouped by film brand; this maps each file to a look group, a clean name
// and the example photo its tile is rendered on (lib/filters/tile-render.ts). Pure, so it's
// unit tested (tests/filter-looks.test.ts).

export const LOOK_GROUPS = ["Featured", "Portrait", "Life", "Landscape", "Sunset", "Food", "Night", "Movies", "Retro", "Mono", "Style"] as const;
export type LookGroup = (typeof LOOK_GROUPS)[number];
type Group = Exclude<LookGroup, "Featured">;

/** The bundled example photos (public/filter-photos), by file name without the extension. */
export const PHOTOS = ["portrait-woman", "portrait-man", "landscape", "sunset", "food", "city", "night", "interior", "nature", "product"] as const;
export type Photo = (typeof PHOTOS)[number];

/** The photos that suit each group; a family of filters takes one of them (the same for its variants). */
const GROUP_PHOTOS: Record<Group, Photo[]> = {
  Portrait: ["portrait-woman", "portrait-man"],
  Life: ["city", "interior", "nature", "portrait-man", "product"],
  Landscape: ["landscape", "nature", "sunset"],
  Sunset: ["sunset", "city", "landscape"],
  Food: ["food", "interior", "product"],
  Night: ["night", "city", "portrait-woman"],
  Movies: ["city", "night", "portrait-man", "portrait-woman", "landscape"],
  Retro: ["portrait-woman", "interior", "city", "portrait-man"],
  Mono: ["portrait-woman", "city", "portrait-man", "landscape"],
  Style: ["nature", "product", "city", "portrait-woman"],
};

/** The best of each group, in this order, as the Featured heading. Matched by file name. */
export const FEATURED = [
  "kodak_portra_400_2",
  "fuji_velvia_50",
  "kodak_ektar_100",
  "kodak_kodachrome_64",
  "tealorange",
  "goldfx-perfect-sunset-05min",
  "kodak_portra_160_nc_2",
  "polaroid_690_3",
  "nightfromday",
  "fuji_superia_400_2",
  "bleachbypass2",
  "kodak_tri-x_400_2",
  "fuji_provia_100f",
  "kodak_elite_color_200",
  "lomography_redscale_100",
  "fuji_xtrans_iii_-_classic_chrome",
  "moonlight",
  "fuji_neopan_acros_100",
  "polaroid_px-70_3",
  "tealmagentagold",
  "ilford_hp5_2",
  "vintage",
  "softwarming",
  "futuristicbleak1",
];

/** Filter files that do nothing (an identity table); the tab leaves them out. */
export const isIdentity = (id: string) => /identity/i.test(id);

const CREATIVE: [RegExp, string][] = [
  [/^anime/, "Anime"],
  [/^bleachbypass/, "Bleach Bypass"],
  [/^candlelight/, "Candlelight"],
  [/^colornegative/, "Color Negative"],
  [/^crispwarm/, "Crisp Warm"],
  [/^crispwinter/, "Crisp Winter"],
  [/^dropblues/, "Drop Blues"],
  [/^edgyember/, "Edgy Ember"],
  [/^fallcolors/, "Fall Colors"],
  [/^foggynight/, "Foggy Night"],
  [/^futuristicbleak/, "Futuristic Bleak"],
  [/^horrorblue/, "Horror Blue"],
  [/^latesunset/, "Late Sunset"],
  [/^moonlight/, "Moonlight"],
  [/^nightfromday/, "Night From Day"],
  [/^redblueyellow/, "Red Blue Yellow"],
  [/^smokey/, "Smokey"],
  [/^softwarming/, "Soft Warming"],
  [/^tealmagentagold/, "Teal Magenta Gold"],
  [/^tealorange/, "Teal Orange"],
  [/^tensiongreen/, "Tension Green"],
];

const UPPER = new Set(["nc", "vc", "uc", "hc", "hg", "ir", "hie", "gx", "vs", "cn", "apx", "xp2", "hps", "px", "iii", "ii", "i", "bw", "uv"]);
const SPECIAL: Record<string, string> = { xpro: "X-Pro", "x-tra": "X-Tra", "t-max": "T-Max", tmax: "T-Max", "tri-x": "Tri-X", "b&w": "B&W", ye: "Y", r: "R", g: "G" };

const word = (w: string): string => {
  if (SPECIAL[w]) return SPECIAL[w];
  if (/^\d+min$/.test(w)) return `${parseInt(w, 10)} min`;
  if (UPPER.has(w)) return w.toUpperCase();
  if (/\d/.test(w)) return w.toUpperCase().replace(/\+$/, "+");
  return w.replace(/(^|[-+(])([a-z])/g, (_, a, c) => a + c.toUpperCase());
};

/** A clean display name: "kodak_portra_400_3_+" is "Kodak Portra 400 3+", an Apple table drops the brand. */
export const cleanName = (id: string): string => {
  let s = id.toLowerCase();
  const creative = CREATIVE.find(([re]) => re.test(s));
  if (creative) return `${creative[1]}${/(\d+)$/.exec(s)?.[1] ? ` ${/(\d+)$/.exec(s)![1]}` : ""}`;
  s = s.replace(/^apple_/, "").replace(/^fuji_xtrans_iii_-_/, "x-trans_iii_");
  if (/^(analogfx|goldfx|technicalfx|zilverfx)-/.test(s)) s = s.replace(/^[a-z]+fx-/, "").replace(/-/g, "_");
  // The numbered variants: "…_3_+" (strength 3, plus), "…_3_alt".
  const v = /^(.*?)_(\d)(?:_(\+{1,3}|-{1,3}))?(?:_(alt))?$/.exec(s);
  const base = v ? v[1] : s;
  const words = base.split("_").filter(Boolean).map(word);
  if (v) words.push(`${v[2]}${v[3] ?? ""}`);
  if (v?.[4]) words.push("Alt");
  return words.join(" ");
};

/** A family: the file with its variant number dropped ("kodak_portra_400_2" and "_3_+" are one). */
const familyOf = (id: string) => id.replace(/_(\d)(?:_(\+{1,3}|-{1,3}))?(?:_alt)?$/, "").replace(/\d+$/, "");

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
};

/** The look group of a filter by its file name and the folders above it (lower-case, "/"-joined). */
export const groupOf = (id: string, dir: string): Group => {
  const s = id.toLowerCase();
  if (/black_and_white/.test(dir) || /^(apple_)?(mono|silver|black)$/.test(s) || /acros|xtrans_iii_-_mono|zilverfx/.test(s)) return "Mono";
  if (/foggynight|moonlight|nightfromday|candlelight|horrorblue|dropblues|smokey|^dark$|^smoky$|_800z_|superia_1600|superia_hg_1600|portra_800|superia_800/.test(s)) return "Night";
  if (/goldfx|latesunset|edgyember|fallcolors|softwarming|crispwarm|redblueyellow|^warm$|^rosy$|redscale|_warm$|_warm_/.test(s) && !/polaroid/.test(s)) return "Sunset";
  if (/tealorange|tealmagentagold|bleachbypass|futuristicbleak|tensiongreen|crispwinter|classic_chrome|^cold$|_cold$/.test(s)) return "Movies";
  if (/polaroid|analogfx|lomography|xpro|kodachrome|sepia|^vintage$|elite_100|time_zero|_cold_/.test(s)) return "Retro";
  if (/portra|_160c_|_400h_|astia|pro_neg|^calm$|^bright$/.test(s)) return "Portrait";
  if (/velvia|provia|ektachrome|elite_chrome|sensia|e-100|apple_intense|^intense$/.test(s)) return "Landscape";
  if (/elite_color|elite_extracolor|ektar|ultra_color|apple_spectacular|x-tra/.test(s)) return "Food";
  if (/technicalfx|colornegative|^dramatic$|^anime|^flamboyant$|^loud$/.test(s)) return "Style";
  return "Life";
};

export type Look = { id: string; name: string; group: Group; photo: Photo; featured: number };

/** Everything the tab needs to know about a filter, from its id and its small file's path. */
export const lookOf = (id: string, path: string): Look => {
  const dir = path.replace(/\\/g, "/").toLowerCase().replace(/^.*\/filters\/small\//, "");
  const group = groupOf(id, dir);
  const photos = GROUP_PHOTOS[group];
  return { id, name: cleanName(id), group, photo: photos[hash(familyOf(id.toLowerCase())) % photos.length], featured: FEATURED.indexOf(id.toLowerCase()) };
};

/** The column under Filters, in CapCut's order, with only the groups that have filters. */
export const lookSections = (groups: Iterable<string>) => {
  const have = new Set(groups);
  return LOOK_GROUPS.filter((g) => g === "Featured" || have.has(g)).map((g) => ({ id: `cat:${g}`, label: g, under: "Filters" }));
};
