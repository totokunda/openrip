// The project's cover, as CapCut's cover editor sets it: a frame of the project, or a local
// image, with text on it. The choice is saved in the project (settings.cover) so the editor
// opens where it was left; the picture itself is the project's cover file (covers/project-N.jpg),
// which the home screen and the export dialog show. While a project has a chosen cover, the
// automatic one (the first frame, rewritten as the project changes) leaves it alone.
import { engineExportStill, getUserDataPath, saveProjectCover, clearProjectCover } from "@app/preload";
import { useProjectsStore } from "./projects";
import { useCoverStore, type CoverSpec, type CoverText } from "./cover-store";

export { useCoverStore, type CoverSpec, type CoverText, type CoverSource } from "./cover-store";
import { useEnginePreviewStore } from "./engine-preview";
import { useViewportStore } from "./viewport";

/**
 * Open the cover editor (the timeline's Cover tile, the export dialog's Edit cover). It works
 * on the project open in the editor, and needs the engine's preview to pick a frame; a local
 * image works without.
 */
export const openCoverEditor = () => useCoverStore.getState().openEditor();

/** A text of the cover editor's three kinds (Add a title, a subtitle, body text). */
export const COVER_TEXT_KINDS = {
  title: { label: "Add a title", text: "Title", size: 0.075, bold: true },
  subtitle: { label: "Add a subtitle", text: "Subtitle", size: 0.05, bold: true },
  body: { label: "Add body text", text: "Body text", size: 0.035, bold: false },
} as const;

/** The cover's text colours. */
export const COVER_COLORS = ["#ffffff", "#000000", "#ae81ce", "#ffd84d", "#ff5a5f", "#4cc9f0", "#6ee06e"];

const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';
/** The cover's height in pixels (the width follows the project's canvas). */
export const COVER_HEIGHT = 720;

let rotation = 0;
/** The engine's picture of the project at `timeUs`, as a file the renderer can load; its path, or null. */
export const renderStill = async (timeUs: number): Promise<{ path: string; width: number; height: number } | null> => {
  const dir = (await getUserDataPath())?.data?.user_data;
  if (!dir) return null;
  const path = `${dir}/cover-still-${rotation++ % 3}.png`;
  const r = await engineExportStill(Math.max(0, Math.round(timeUs)), path);
  return r.ok ? { path, width: r.width, height: r.height } : null;
};

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    // The app:// scheme sends CORS headers: without this, a canvas the image is drawn on can't be read back.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The picture couldn't be loaded"));
    img.src = src;
  });

/** Draw `texts` on `ctx` over a canvas of `width`×`height`, as the editor's boxes show them. */
export const drawCoverTexts = (ctx: CanvasRenderingContext2D, width: number, height: number, texts: CoverText[]) => {
  for (const t of texts) {
    const px = Math.max(4, t.size * height);
    ctx.font = `${t.bold ? "700" : "400"} ${px}px ${FONT}`;
    ctx.fillStyle = t.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = t.text.split("\n");
    const lead = px * 1.2;
    lines.forEach((line, i) => ctx.fillText(line, t.x * width, t.y * height + (i - (lines.length - 1) / 2) * lead));
  }
};

/** The base picture drawn into a canvas of the cover's size: filled and centred (an image's overflow is cropped). */
export const drawCoverBase = (ctx: CanvasRenderingContext2D, width: number, height: number, img: HTMLImageElement) => {
  const s = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
};

/** The cover as a JPEG: the base picture with its texts, 720 px tall at the canvas's shape. */
export const renderCoverJpeg = async (base: HTMLImageElement, texts: CoverText[]): Promise<Uint8Array> => {
  const aspect = useViewportStore.getState().aspectRatio;
  const ratio = aspect && aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : base.naturalWidth / base.naturalHeight;
  const height = COVER_HEIGHT;
  const width = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  drawCoverBase(ctx, width, height, base);
  drawCoverTexts(ctx, width, height, texts);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("The cover couldn't be drawn");
  return new Uint8Array(await blob.arrayBuffer());
};

/** Write the cover file for the open project and keep its choice. The home screen and export dialog follow `coverPath`. */
export const saveCover = async (spec: CoverSpec, jpeg: Uint8Array) => {
  const id = useProjectsStore.getState().activeProjectId;
  if (id == null) throw new Error("No project is open");
  const res = await saveProjectCover(id, jpeg);
  if (!res?.success || !res.data?.path) throw new Error(res?.error || "The cover couldn't be saved");
  useCoverStore.getState().setCover(spec);
  useProjectsStore.getState().updateProject(id, { coverPath: res.data.path, lastModified: Date.now() });
};

/** Go back to the automatic cover (the first frame). */
export const resetCover = async () => {
  const id = useProjectsStore.getState().activeProjectId;
  useCoverStore.getState().setCover(null);
  if (id != null) {
    await clearProjectCover(id).catch(() => {});
    useProjectsStore.getState().updateProject(id, { coverPath: undefined, lastModified: Date.now() });
  }
};

/** True when the engine can draw frames of the open project (the frame selector needs it). */
export const canPickFrames = () => {
  const e = useEnginePreviewStore.getState();
  return !!e.info?.available && !!e.project;
};
