// The Filters tab's tile pictures: a filter's example photo (public/filter-photos) put through
// the filter's own table with the engine's maths (lib/filters/lut.ts), drawn when the tile
// comes into view and kept for the session. A few at a time, so scrolling the grid stays smooth.
import { useEffect, useState } from "react";
import { applyHald } from "./lut";

/** A tile is 86 px; its picture is twice that. */
export const TILE_PX = 172;

export const photoUrl = (photo: string) => `filter-photos/${photo}.webp`;

/** The small table's URL, relative to the app's page (the library's `smallPath` is a file path). */
export const lutUrl = (smallPath: string) => {
  const p = smallPath.replace(/\\/g, "/");
  const i = p.lastIndexOf("/filters/small/");
  return i >= 0 ? `filters/small/${p.slice(i + "/filters/small/".length).split("/").map(encodeURIComponent).join("/")}` : p;
};

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });

const pixels = (img: HTMLImageElement, w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
};

const photos = new Map<string, Promise<ImageData>>();
/** An example photo's pixels at the tile's size (read once). */
export const photoPixels = (photo: string) => {
  let p = photos.get(photo);
  if (!p) {
    p = load(photoUrl(photo)).then((img) => pixels(img, TILE_PX, TILE_PX));
    photos.set(photo, p);
  }
  return p;
};

const done = new Map<string, string>();
const waiting = new Map<string, Promise<string>>();
const queue: (() => void)[] = [];
let running = 0;
const MAX_RUNNING = 3;

const pump = () => {
  while (running < MAX_RUNNING && queue.length) {
    running++;
    queue.shift()!();
  }
};

const render = async (smallPath: string, photo: string): Promise<string> => {
  const [src, img] = await Promise.all([photoPixels(photo), load(lutUrl(smallPath))]);
  const lut = pixels(img, img.naturalWidth, img.naturalHeight);
  const out = applyHald(src.data, lut.data, lut.width, lut.height);
  const c = document.createElement("canvas");
  c.width = TILE_PX;
  c.height = TILE_PX;
  c.getContext("2d")!.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, TILE_PX, TILE_PX), 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
  return blob ? URL.createObjectURL(blob) : c.toDataURL("image/jpeg", 0.9);
};

/** The tile picture for a filter's table on a photo: its object URL, drawn once and cached. */
export const tilePicture = (smallPath: string, photo: string): Promise<string> => {
  const key = `${photo}|${smallPath}`;
  const have = done.get(key);
  if (have) return Promise.resolve(have);
  let p = waiting.get(key);
  if (!p) {
    p = new Promise<string>((resolve, reject) => {
      queue.push(() => {
        render(smallPath, photo)
          .then((url) => {
            done.set(key, url);
            resolve(url);
          }, reject)
          .finally(() => {
            running--;
            waiting.delete(key);
            pump();
          });
      });
      pump();
    });
    waiting.set(key, p);
  }
  return p;
};

/**
 * The picture for a tile: the plain photo until the filtered one is drawn (it starts once the
 * tile is on screen: `visible`), then that.
 */
export const useTilePicture = (smallPath: string, photo: string, visible: boolean): { src: string; filtered: boolean } => {
  const key = `${photo}|${smallPath}`;
  const [got, setSrc] = useState<{ key: string; url: string } | undefined>();
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void tilePicture(smallPath, photo).then(
      (url) => live && setSrc({ key, url }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, smallPath, photo, visible]);
  const url = done.get(key) ?? (got?.key === key ? got.url : undefined);
  return url ? { src: url, filtered: true } : { src: photoUrl(photo), filtered: false };
};
