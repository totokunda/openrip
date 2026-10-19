import React, { useEffect, useRef, useState } from "react";
import { useStoredList } from "@/lib/user-store";
import { LuChevronDown, LuChevronUp, LuPipette, LuPlus } from "react-icons/lu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * CapCut's colour well and picker (docs/plan/capcut-ui-spec.md §4.8b): an 84×22 well (the
 * swatch inset 2 px, a chevron beside it) that opens a 246 px popover: a saturation/value
 * square, the eyedropper and the hue bar, the value as Hex or RGB, and swatches (the user's
 * own, "+" saving the current colour, or a preset palette). No alpha, as CapCut's: opacity
 * has its own slider where there is one. Colours are `#rrggbb`.
 */

type Hsv = { h: number; s: number; v: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const hexToRgb = (hex: string): [number, number, number] => {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) && h.length >= 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
};

export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

const rgbToHsv = ([r, g, b]: [number, number, number]): Hsv => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

const hsvToHex = ({ h, s, v }: Hsv) => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return rgbToHex(f(5), f(3), f(1));
};

/** The palette offered under "Presets": greys, then CapCut-like rows of hues. Our own picks. */
const PRESET_COLORS = [
  "#ffffff", "#b3b3b3", "#808080", "#404040", "#000000", "#f2c94c", "#f2994a", "#eb5757", "#bb6bd9", "#2f80ed",
  "#56ccf2", "#27ae60", "#6fcf97", "#fce4ec", "#f48fb1", "#ec407a", "#ad1457", "#880e4f", "#ffcdd2", "#ef9a9a",
  "#e57373", "#e53935", "#b71c1c", "#ffccbc", "#ffab91", "#ff7043", "#e64a19", "#bf360c", "#fff9c4", "#fff176",
  "#fdd835", "#f9a825", "#c5e1a5", "#9ccc65", "#558b2f", "#b2ebf2", "#4dd0e1", "#00838f", "#c5cae9", "#5c6bc0",
];

const MY_COLORS_KEY = "openrip:my-colors";
const MY_COLORS_MAX = 39;

const parseMyColors = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : undefined;

/** A pointer drag over an element, reporting where it is as fractions of the element's box. */
const useDrag = (onMove: (x: number, y: number) => void) => {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
    },
  };
};

const ColorPicker: React.FC<{ value: string; onChange: (hex: string) => void }> = ({ value, onChange }) => {
  // The hue survives greys and black (where the colour itself has none).
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(value)));
  const [format, setFormat] = useState<"hex" | "rgb">("hex");
  const [palette, setPalette] = useState<"mine" | "presets">("presets");
  const [mine, setMine] = useStoredList<string>("my-colours", MY_COLORS_KEY, parseMyColors);
  // The saved colours show first once they have been read.
  useEffect(() => {
    if (mine.length) setPalette((p) => (p === "presets" ? "mine" : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.length > 0]);
  const [hexText, setHexText] = useState(value.replace("#", "").toUpperCase());
  const lastSent = useRef(value.toLowerCase());

  // A change from outside (undo, another field) moves the handles.
  useEffect(() => {
    if (value.toLowerCase() === lastSent.current) return;
    lastSent.current = value.toLowerCase();
    const next = rgbToHsv(hexToRgb(value));
    setHsv((h) => (next.s === 0 || next.v === 0 ? { ...next, h: h.h } : next));
  }, [value]);
  useEffect(() => setHexText(value.replace("#", "").toUpperCase()), [value]);

  const send = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    lastSent.current = hex;
    onChange(hex);
  };
  const setHex = (hex: string) => {
    const rgb = hexToRgb(hex);
    const out = rgbToHex(...rgb);
    lastSent.current = out;
    const next = rgbToHsv(rgb);
    setHsv((h) => (next.s === 0 || next.v === 0 ? { ...next, h: h.h } : next));
    onChange(out);
  };

  const square = useDrag((x, y) => send({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => send({ ...hsv, h: Math.min(359.9, x * 360) }));
  const [r, g, b] = hexToRgb(value);
  const swatches = palette === "mine" ? mine : PRESET_COLORS;
  const eyeDropper = (window as any).EyeDropper;

  return (
    <div className="flex flex-col gap-[10px]" data-testid="color-picker">
      {/* Saturation (across) and value (up) at the hue. */}
      <div
        {...square}
        data-testid="color-sv"
        className="relative w-[226px] h-[120px] rounded-[4px] cursor-crosshair touch-none"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
      >
        <span
          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>
      <div className="flex flex-row items-center gap-[10px]">
        <button
          type="button"
          title="Pick a colour from the screen"
          aria-label="Pick a colour from the screen"
          disabled={!eyeDropper}
          onClick={async () => {
            try {
              const picked = await new eyeDropper().open();
              if (picked?.sRGBHex) setHex(picked.sRGBHex);
            } catch {}
          }}
          className="w-[22px] h-[22px] shrink-0 rounded-[4px] bg-brand-background-light text-brand-light hover:bg-brand-button flex items-center justify-center disabled:opacity-40"
        >
          <LuPipette className="w-3 h-3" />
        </button>
        <div
          {...hue}
          data-testid="color-hue"
          className="relative flex-1 h-[22px] rounded-full cursor-pointer touch-none"
          style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
        >
          <span
            className="absolute top-1/2 w-[17px] h-[17px] -ml-[8.5px] -mt-[8.5px] rounded-full border-2 border-white pointer-events-none"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
          />
        </div>
      </div>
      <div className="flex flex-row items-center gap-[6px]">
        <select
          aria-label="Colour format"
          value={format}
          onChange={(e) => setFormat(e.target.value as "hex" | "rgb")}
          className="w-[52px] h-[22px] shrink-0 rounded-[4px] bg-brand-background-light text-[12px] font-semibold text-brand-lighter px-1 outline-none"
        >
          <option value="hex">Hex</option>
          <option value="rgb">RGB</option>
        </select>
        {format === "hex" ? (
          <input
            aria-label="Hex colour"
            data-testid="color-hex"
            value={hexText}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={() => (/^#?[0-9a-f]{6}$/i.test(hexText.trim()) ? setHex(`#${hexText.trim().replace("#", "")}`) : setHexText(value.replace("#", "").toUpperCase()))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="flex-1 min-w-0 h-[22px] rounded-[4px] bg-brand px-2 text-[12px] tabular-nums text-brand-lighter outline-none uppercase"
          />
        ) : (
          ([r, g, b] as const).map((c, i) => (
            <input
              // Keyed by its value, so a change from elsewhere shows.
              key={`${i}:${c}`}
              aria-label={["Red", "Green", "Blue"][i]}
              defaultValue={c}
              onBlur={(e) => {
                const n = Math.min(255, Math.max(0, Math.round(Number(e.target.value))));
                if (!Number.isFinite(n)) return;
                const rgb: [number, number, number] = [r, g, b];
                rgb[i] = n;
                setHex(rgbToHex(...rgb));
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="flex-1 min-w-0 h-[22px] rounded-[4px] bg-brand text-center text-[12px] tabular-nums text-brand-lighter outline-none"
            />
          ))
        )}
      </div>
      <div className="h-px bg-brand-divider" />
      <select
        aria-label="Swatches"
        value={palette}
        onChange={(e) => setPalette(e.target.value as "mine" | "presets")}
        className="w-full h-[22px] rounded-[4px] bg-brand-background-light text-[12px] font-semibold text-brand-lighter px-2 outline-none"
      >
        <option value="mine">My colors</option>
        <option value="presets">Presets</option>
      </select>
      <div className="grid grid-cols-10 gap-x-[6.5px] gap-y-[6.5px]">
        {palette === "mine" && (
          <button
            type="button"
            title="Save this colour"
            aria-label="Save this colour"
            onClick={() => {
              const next = [value.toLowerCase(), ...mine.filter((c) => c !== value.toLowerCase())].slice(0, MY_COLORS_MAX);
              setMine(next);
            }}
            className="w-4 h-4 rounded-[3px] bg-brand-background-light text-brand-lighter flex items-center justify-center hover:bg-brand-button"
          >
            <LuPlus className="w-3 h-3" />
          </button>
        )}
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={c}
            onClick={() => setHex(c)}
            className={cn("w-4 h-4 rounded-[3px] border border-black/20", c.toLowerCase() === value.toLowerCase() && "ring-[1.5px] ring-white ring-offset-1 ring-offset-brand-background")}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
};

/** The well: the colour in an 84×22 frame with a chevron; it opens the picker below it. */
const ColorWell: React.FC<{ value: string; onChange: (hex: string) => void; label: string; testId?: string }> = ({ value, onChange, label, testId }) => {
  const [open, setOpen] = useState(false);
  const color = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#000000";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          data-color={color}
          className="w-[84px] h-[22px] shrink-0 rounded-[4px] bg-brand-background-light flex flex-row items-center p-[2px] hover:bg-brand-button transition-colors"
        >
          <span className="w-[64px] h-[18px] rounded-[3px]" style={{ background: color }} />
          <span className="flex-1 flex items-center justify-center text-brand-light">{open ? <LuChevronUp className="w-3 h-3" /> : <LuChevronDown className="w-3 h-3" />}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        className="w-[246px] p-[10px] rounded-[8px] bg-brand-background border-[0.5px] border-[#494949] shadow-[0_0_0_0.5px_#000,0_8px_24px_rgba(0,0,0,0.5)] text-brand-light"
      >
        <ColorPicker value={color} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};

export default ColorWell;
