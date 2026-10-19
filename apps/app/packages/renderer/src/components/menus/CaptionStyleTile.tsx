import React from "react";
import type { CaptionStyle } from "@/lib/caption-actions";
import TextLook from "./TextLook";

/**
 * A caption style's picture in a tile: its look on two words, and for OpenRip's word-by-word
 * styles what it does to the word being said (the first word here): its colour, a fill
 * running across it, a second word not yet there, or a box under it. A CSS approximation for
 * choosing; the engine's drawing is the real one.
 */
const CaptionStyleTile: React.FC<{ style: CaptionStyle; size?: number; fit?: number }> = ({ style, size = 17, fit = 72 }) => {
  const color = style.props.captionColor ?? "#ffe600";
  if (!style.kind) return <TextLook look={style.props} text="Caption" size={size} fit={fit} />;
  const word = (text: string, look: Partial<typeof style.props>, extra?: React.CSSProperties) => (
    <span style={extra} className="inline-flex rounded-[3px]">
      <TextLook look={look} text={text} size={size - 2} fit={fit / 2} />
    </span>
  );
  const base = style.props;
  switch (style.kind) {
    case "highlight":
      return (
        <span className="flex gap-1 items-center">
          {word("Hello", { ...base, color })}
          {word("world", base)}
        </span>
      );
    case "karaoke":
      return (
        <span className="flex gap-1 items-center">
          {word("Hello", { ...base, color })}
          {word("world", { ...base, color: base.color })}
        </span>
      );
    case "pop":
      return (
        <span className="flex gap-1 items-center">
          {word("Hello", base)}
          {word("world", { ...base, color }, { opacity: 0.95 })}
        </span>
      );
    default:
      return (
        <span className="flex gap-1 items-center">
          {word("Hello", { ...base, color: "#111111", strokeEnabled: false, shadowEnabled: false }, { background: color, padding: "1px 3px" })}
          {word("world", base)}
        </span>
      );
  }
};

export default CaptionStyleTile;
