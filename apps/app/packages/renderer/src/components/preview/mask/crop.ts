import { ClipTransform } from "@/lib/types";

export const getCropOffset = (
  transform?: ClipTransform | null,
): { offsetX: number; offsetY: number } => {
  if (!transform) {
    return { offsetX: 0, offsetY: 0 };
  }

  const anyTransform = transform as any;
  const crop = anyTransform?.crop as
    | { x?: number; y?: number; width?: number; height?: number }
    | undefined;

  const hasValidCrop =
    crop &&
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    Number.isFinite(transform.width) &&
    Number.isFinite(transform.height);

  if (!hasValidCrop) {
    return { offsetX: 0, offsetY: 0 };
  }

  const cropW = crop!.width && crop!.width > 0 ? crop!.width : 1;
  const cropH = crop!.height && crop!.height > 0 ? crop!.height : 1;

  const baseWidth = (transform.width as number) || 0;
  const baseHeight = (transform.height as number) || 0;
  const offsetX = (baseWidth / cropW) * (crop!.x as number);
  const offsetY = (baseHeight / cropH) * (crop!.y as number);

  return {
    offsetX,
    offsetY,
  };
};
