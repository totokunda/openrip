import React from "react";
import { textStyleCss } from "@/lib/text-styles";
import type { TextClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Words drawn in a text clip's look with CSS, for a library tile (a preset, a caption style):
 * its font, weight, case, colour or gradient, stroke, shadow, glow, background, and its
 * Effects style when it has one. An approximation for choosing; the engine's drawing is the
 * real one.
 */
const TextLook: React.FC<{ look: Partial<TextClipProps>; text: string; size?: number; fit?: number; className?: string }> = ({ look: t, text, size: largest = 18, fit = 70, className }) => {
  const color = t.color ?? "#ffffff";
  // Small enough for the words to fit `fit` px across (a bold character is about 0.65 em).
  const size = Math.max(9, Math.min(largest, Math.floor(fit / Math.max(1, text.length * ((t.fontWeight ?? 400) >= 600 ? 0.68 : 0.58)))));
  // Sizes are in the app's world units against its font size; scaled to the tile's size.
  const k = size / Math.max(1, t.fontSize ?? 32);
  const css: React.CSSProperties = {
    fontFamily: `"${t.fontFamily ?? "Arial"}"`,
    fontWeight: t.fontWeight ?? 400,
    fontStyle: t.fontStyle ?? "normal",
    fontSize: size,
    textTransform: t.textTransform === "none" ? undefined : t.textTransform,
    textDecoration: t.textDecoration === "underline" ? "underline" : undefined,
    letterSpacing: t.letterSpacing ? `${(t.letterSpacing / 20) * size}px` : undefined,
    color,
  };
  if (t.textEffect) {
    Object.assign(css, textStyleCss(t.textEffect, color, size));
  } else {
    if (t.fillGradient) {
      const g = t.fillGradient;
      css.backgroundImage = `linear-gradient(${90 - g.angle}deg, ${g.colors.join(", ")})`;
      css.WebkitBackgroundClip = "text";
      css.color = "transparent";
    }
    if (t.strokeEnabled) {
      css.WebkitTextStroke = `${Math.max(1, (t.strokeWidth ?? 2) * k * 2).toFixed(1)}px ${t.stroke ?? "#000"}`;
      css.paintOrder = "stroke fill";
    }
    const shadows: string[] = [];
    if (t.shadowEnabled) {
      const a = (t.shadowOpacity ?? 75) / 100;
      shadows.push(`${((t.shadowOffsetX ?? 2) * k).toFixed(1)}px ${((t.shadowOffsetY ?? 2) * k).toFixed(1)}px ${((t.shadowBlur ?? 4) * k).toFixed(1)}px rgba(0,0,0,${a})`);
    }
    if (t.glowEnabled) shadows.push(`0 0 ${(((t.glowRange ?? 20) / 100) * size * 1.5 + 2).toFixed(1)}px ${t.glowColor || color}`);
    if (shadows.length) css.textShadow = shadows.join(", ");
  }
  if (t.backgroundEnabled) {
    const a = Math.round(((t.backgroundOpacity ?? 100) / 100) * 255).toString(16).padStart(2, "0");
    css.background = `${(t.backgroundColor ?? "#000000").slice(0, 7)}${a}`;
    css.padding = "1px 6px";
    css.borderRadius = Math.min(8, (t.backgroundCornerRadius ?? 0) * k);
  }
  return (
    <span className={cn("leading-none whitespace-nowrap max-w-full overflow-hidden", className)} style={css}>
      {text}
    </span>
  );
};

export default TextLook;
