import React, { useMemo, useState } from "react";
import { IoLockClosed, IoLockOpen, IoRefreshOutline } from "react-icons/io5";
import { PiAlignBottom, PiAlignCenterHorizontal, PiAlignCenterVertical, PiAlignLeft, PiAlignRight, PiAlignTop } from "react-icons/pi";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClipStore } from "@/lib/clip";
import { useViewportStore } from "@/lib/viewport";
import { BASE_LONG_SIDE } from "@/lib/settings";
import { capcutPx, capOf, fillOn, hasCorners, isOpenShape, SHAPE_FILL, SHAPE_STROKE, strokeOn, worldCanvas } from "@/lib/shape-presets";
import type { ClipTransform, ShapeClipProps, StrokeCap, StrokeStyle } from "@/lib/types";
import { cn } from "@/lib/utils";
import ColorInput from "./ColorInput";
import Input from "./Input";
import PropertiesSlider from "./PropertiesSlider";

/**
 * A shape's inspector, as CapCut's Shapes tab: groups for Transform (size with its lock,
 * scale, uniform scale, position, rotate, align, opacity), Fill (colour and opacity; not on a
 * line, an arrow or an open pen path), Stroke (style, an open outline's caps, colour, weight,
 * opacity), Corner radius (shapes with corners) and Shadow (colour, distance, angle, opacity).
 * Fill, Stroke, Corner radius and Shadow each have a check that turns them on. Sizes are
 * CapCut's: pixels of the canvas at 1080p; position is the shape's middle from the canvas's,
 * up positive.
 *
 * While the Pen is still drawing the shape, the tab says so instead (CapCut's words).
 */

const ROW = "flex items-center min-h-[22px] gap-2 min-w-0";
const LABEL = "w-[68px] shrink-0 text-left text-[11px] text-brand-light";

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={ROW}>
    <span className={LABEL}>{label}</span>
    <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
  </div>
);

/** A group as CapCut's PanelSettingsGroup: its title (with a check when it can be turned off) and a reset. */
const Group: React.FC<{
  title: string;
  testId: string;
  checked?: boolean;
  onCheck?: (on: boolean) => void;
  onReset: () => void;
  children: React.ReactNode;
}> = ({ title, testId, checked, onCheck, onReset, children }) => (
  <section data-testid={`shape-group-${testId}`} className="flex flex-col gap-4 px-3 py-4 border-b border-brand-divider">
    <div className="flex items-center gap-2 h-[22px]">
      {onCheck && <Checkbox data-testid={`shape-check-${testId}`} checked={!!checked} onCheckedChange={(v) => onCheck(!!v)} />}
      <h4 className="flex-1 text-left text-[12.5px] font-semibold text-brand-lighter">{title}</h4>
      <button type="button" title="Reset" aria-label={`Reset ${title}`} onClick={onReset} className="text-brand-light hover:text-brand-lighter cursor-pointer">
        <IoRefreshOutline className="w-3.5 h-3.5" />
      </button>
    </div>
    <div className={cn("flex flex-col gap-4", onCheck && !checked && "opacity-30 pointer-events-none")}>{children}</div>
  </section>
);

const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={() => onChange(!on)}
    className={cn("relative w-9 h-4 rounded-full transition-colors shrink-0", on ? "bg-brand-accent" : "bg-brand-button")}
  >
    <span className={cn("absolute top-1 w-2 h-2 rounded-full bg-brand-lighter transition-all", on ? "left-[24px]" : "left-1")} />
  </button>
);

const Choice: React.FC<{ value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testId: string; prefix?: string }> = ({
  value,
  options,
  onChange,
  testId,
  prefix,
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger data-testid={testId} size="sm" className="w-full min-w-0 !h-[22px] text-[12px] bg-brand-background-light border-0 rounded-[4px] text-brand-light">
      {prefix && <span className="text-brand-light/50">{prefix}</span>}
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value} className="text-[12px]">
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const STYLES: { value: StrokeStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const CAPS: { value: StrokeCap; label: string }[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "round", label: "Round" },
];

/** What a reset puts back: a new shape's stroke (CapCut's panel resets its Weight to 8, perhaps in other units than the 4 px it gives a new shape; the 4 px is kept), its panel's shadow and its corner radius's first value. */
const RESET = { strokePx: 4, shadowPx: 10, shadowAngle: 45, shadowOpacity: 50, cornerPx: 5 };

/** The shape's middle in world units: corner-pinned shapes turn about their top-left, the app's ellipse, polygon and star about their middle. */
const middleOf = (clip: ShapeClipProps, t: ClipTransform) => {
  const w = t.width * (t.scaleX ?? 1);
  const h = t.height * (t.scaleY ?? 1);
  if (clip.shapeType === "ellipse" || clip.shapeType === "polygon" || clip.shapeType === "star") return { x: t.x + w / 2, y: t.y + h / 2 };
  const r = ((t.rotation ?? 0) * Math.PI) / 180;
  return { x: t.x + (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r), y: t.y + (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r) };
};

const ShapeProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as ShapeClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const aspect = useViewportStore((s) => s.aspectRatio);
  const canvas = useMemo(() => worldCanvas(aspect, BASE_LONG_SIDE), [aspect]);
  const k = capcutPx(canvas);
  const [locked, setLocked] = useState(false);
  const [uniform, setUniform] = useState(true);

  if (!clip?.transform) return null;
  const t = clip.transform;

  if (clip.penDrawing) {
    return (
      <div data-testid="shape-drawing" className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
        <svg viewBox="0 0 40 40" className="w-10 h-10 text-[#7a7a7a]" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M7 31 C 10 14, 22 9, 33 11" />
          <rect x="5" y="29" width="4" height="4" />
          <rect x="31" y="9" width="4" height="4" />
          <path d="M22 35 L26 24 L33 31 Z" strokeLinejoin="round" />
        </svg>
        <p className="text-[13px] text-[#7a7a7a]">You can edit the shape here later.</p>
        <p className="text-[12px] text-[#7a7a7a]">Double-click the preview area to finish drawing.</p>
      </div>
    );
  }

  const px = (world: number) => world / k;
  const world = (p: number) => p * k;
  const set = (patch: Partial<ShapeClipProps>) => updateClip(clipId, patch);
  // A transform change that keeps the shape's middle where it was.
  const setAroundMiddle = (patch: Partial<ClipTransform>) => {
    const before = middleOf(clip, t);
    const next = { ...t, ...patch };
    const after = middleOf(clip, next);
    set({ transform: { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y } });
  };
  const mid = middleOf(clip, t);
  const posX = px(mid.x - canvas.width / 2);
  const posY = px(canvas.height / 2 - mid.y);
  const open = isOpenShape(clip);
  const corners = hasCorners(clip.shapeType);
  const maxCorner = Math.min(t.width, t.height) / 2;

  const align = (how: "left" | "center-h" | "right" | "top" | "center-v" | "bottom") => {
    const w = t.width * (t.scaleX ?? 1);
    const h = t.height * (t.scaleY ?? 1);
    const x = how === "left" ? 0 : how === "center-h" ? (canvas.width - w) / 2 : how === "right" ? canvas.width - w : t.x;
    const y = how === "top" ? 0 : how === "center-v" ? (canvas.height - h) / 2 : how === "bottom" ? canvas.height - h : t.y;
    set({ transform: { ...t, x, y } });
  };
  const alignButton = (how: Parameters<typeof align>[0], title: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button key={how} type="button" title={title} onClick={() => align(how)} className="h-full w-7 flex items-center justify-center hover:bg-brand-button transition-colors cursor-pointer rounded-[4px]">
      <Icon className="text-brand-light h-4 w-4" />
    </button>
  );

  return (
    <div data-testid="shape-properties" className="min-w-0">
      <Group
        title="Transform"
        testId="transform"
        onReset={() => setAroundMiddle({ scaleX: 1, scaleY: 1, rotation: 0 })}
      >
        <Row label="Size">
          <Input
            value={px(t.width).toFixed(0)}
            onChange={(v) => {
              const w = world(Math.max(1, Number(v) || 1));
              setAroundMiddle(locked ? { width: w, height: (t.height * w) / (t.width || 1) } : { width: w });
            }}
            startLogo="W"
          />
          <button type="button" aria-label={locked ? "Unlock size" : "Lock size"} onClick={() => setLocked(!locked)} className="h-[22px] w-4 shrink-0 rounded-[4px] bg-[#2d2d32] flex items-center justify-center text-brand-light">
            {locked ? <IoLockClosed className="w-2.5 h-2.5" /> : <IoLockOpen className="w-2.5 h-2.5" />}
          </button>
          <Input
            value={px(t.height).toFixed(0)}
            onChange={(v) => {
              const h = world(Math.max(1, Number(v) || 1));
              setAroundMiddle(locked ? { height: h, width: (t.width * h) / (t.height || 1) } : { height: h });
            }}
            startLogo="H"
          />
        </Row>
        {uniform ? (
          <PropertiesSlider label="Scale" value={Math.round((t.scaleX ?? 1) * 100)} onChange={(v) => setAroundMiddle({ scaleX: v / 100, scaleY: v / 100 })} suffix="%" min={1} max={500} step={1} toFixed={0} />
        ) : (
          <>
            <PropertiesSlider label="Scale width" value={Math.round((t.scaleX ?? 1) * 100)} onChange={(v) => setAroundMiddle({ scaleX: v / 100 })} suffix="%" min={1} max={500} step={1} toFixed={0} />
            <PropertiesSlider label="Scale height" value={Math.round((t.scaleY ?? 1) * 100)} onChange={(v) => setAroundMiddle({ scaleY: v / 100 })} suffix="%" min={1} max={500} step={1} toFixed={0} />
          </>
        )}
        <div className={cn(ROW, "justify-between")}>
          <span className="text-[11px] text-brand-light">Uniform scale</span>
          <Toggle on={uniform} onChange={setUniform} label="Uniform scale" />
        </div>
        <Row label="Position">
          <Input
            value={posX.toFixed(0)}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) set({ transform: { ...t, x: t.x + world(n) + canvas.width / 2 - mid.x } });
            }}
            startLogo="X"
          />
          <Input
            value={posY.toFixed(0)}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) set({ transform: { ...t, y: t.y + canvas.height / 2 - world(n) - mid.y } });
            }}
            startLogo="Y"
          />
        </Row>
        <Row label="Rotate">
          <Input
            value={(t.rotation ?? 0).toFixed(2)}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) setAroundMiddle({ rotation: n });
            }}
            startLogo="°"
          />
        </Row>
        <div className="h-[22px] w-fit flex items-center rounded-[4px] bg-brand-background-light">
          {alignButton("left", "Align left", PiAlignLeft)}
          {alignButton("center-h", "Centre horizontally", PiAlignCenterHorizontal)}
          {alignButton("right", "Align right", PiAlignRight)}
          <span className="w-px h-3 bg-brand-hover" />
          {alignButton("top", "Align top", PiAlignTop)}
          {alignButton("center-v", "Centre vertically", PiAlignCenterVertical)}
          {alignButton("bottom", "Align bottom", PiAlignBottom)}
        </div>
        <PropertiesSlider label="Opacity" value={t.opacity ?? 100} onChange={(v) => set({ transform: { ...t, opacity: Math.max(0, Math.min(100, v)) } })} suffix="%" min={0} max={100} step={1} toFixed={0} />
      </Group>

      {!open && (
        <Group title="Fill" testId="fill" checked={fillOn(clip)} onCheck={(on) => set({ fillEnabled: on })} onReset={() => set({ fill: SHAPE_FILL, fillOpacity: 100 })}>
          <Row label="Color">
            <ColorInput value={clip.fill ?? SHAPE_FILL} onChange={(v) => set({ fill: v })} percentValue={clip.fillOpacity ?? 100} setPercentValue={(v) => set({ fillOpacity: v })} />
          </Row>
          <PropertiesSlider label="Opacity" value={clip.fillOpacity ?? 100} onChange={(v) => set({ fillOpacity: Math.max(0, Math.min(100, v)) })} suffix="%" min={0} max={100} step={1} toFixed={0} />
        </Group>
      )}

      <Group
        title="Stroke"
        testId="stroke"
        checked={strokeOn(clip)}
        onCheck={(on) => set({ strokeEnabled: on, ...(on && !(clip.strokeWidth ?? 0) ? { strokeWidth: world(RESET.strokePx) } : {}) })}
        onReset={() => set({ strokeStyle: "solid", stroke: open ? SHAPE_FILL : SHAPE_STROKE, strokeOpacity: 100, strokeWidth: world(RESET.strokePx), ...(open ? { capStart: "none", capEnd: clip.shapeType === "arrow" ? "arrow" : "none" } : {}) })}
      >
        <Row label="Style">
          <Choice testId="shape-stroke-style" value={clip.strokeStyle ?? "solid"} options={STYLES} onChange={(v) => set({ strokeStyle: v as StrokeStyle })} />
        </Row>
        {open && (
          <Row label="Cap">
            <Choice testId="shape-cap-start" prefix="Start" value={capOf(clip, "start")} options={CAPS} onChange={(v) => set({ capStart: v as StrokeCap })} />
            <Choice testId="shape-cap-end" prefix="End" value={capOf(clip, "end")} options={CAPS} onChange={(v) => set({ capEnd: v as StrokeCap })} />
          </Row>
        )}
        <Row label="Color">
          <ColorInput value={clip.stroke ?? SHAPE_STROKE} onChange={(v) => set({ stroke: v })} percentValue={clip.strokeOpacity ?? 100} setPercentValue={(v) => set({ strokeOpacity: v })} />
        </Row>
        <PropertiesSlider label="Weight" value={Math.round(px(clip.strokeWidth ?? 0))} onChange={(v) => set({ strokeWidth: world(Math.max(1, Math.min(100, v))) })} min={1} max={100} step={1} toFixed={0} />
        <PropertiesSlider label="Opacity" value={clip.strokeOpacity ?? 100} onChange={(v) => set({ strokeOpacity: Math.max(0, Math.min(100, v)) })} suffix="%" min={0} max={100} step={1} toFixed={0} />
      </Group>

      {corners && (
        <Group
          title="Corner radius"
          testId="corner"
          checked={(t.cornerRadius ?? 0) > 0}
          onCheck={(on) => set({ transform: { ...t, cornerRadius: on ? Math.min(world(RESET.cornerPx), maxCorner) : 0 } })}
          onReset={() => set({ transform: { ...t, cornerRadius: 0 } })}
        >
          <Row label="Corner radius">
            <Input
              value={px(t.cornerRadius ?? 0).toFixed(0)}
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n)) set({ transform: { ...t, cornerRadius: Math.max(0, Math.min(maxCorner, world(n))) } });
              }}
              canStep
              step={1}
              min={0}
              max={Math.floor(px(maxCorner))}
            />
          </Row>
        </Group>
      )}

      <Group
        title="Shadow"
        testId="shadow"
        checked={!!clip.shadowEnabled}
        onCheck={(on) => set({ shadowEnabled: on })}
        onReset={() => set({ shadowColor: "#000000", shadowOpacity: RESET.shadowOpacity, shadowDistance: world(RESET.shadowPx), shadowAngle: RESET.shadowAngle })}
      >
        <Row label="Color">
          <ColorInput value={clip.shadowColor ?? "#000000"} onChange={(v) => set({ shadowColor: v })} percentValue={clip.shadowOpacity ?? 50} setPercentValue={(v) => set({ shadowOpacity: v })} />
        </Row>
        <PropertiesSlider label="Distance" value={Math.round(px(clip.shadowDistance ?? 0))} onChange={(v) => set({ shadowDistance: world(Math.max(0, Math.min(100, v))) })} min={0} max={100} step={1} toFixed={0} />
        <PropertiesSlider label="Angle" value={Math.round(clip.shadowAngle ?? 45)} onChange={(v) => set({ shadowAngle: Math.max(-180, Math.min(180, v)) })} suffix="°" min={-180} max={180} step={1} toFixed={0} />
        <PropertiesSlider label="Opacity" value={clip.shadowOpacity ?? 50} onChange={(v) => set({ shadowOpacity: Math.max(0, Math.min(100, v)) })} suffix="%" min={0} max={100} step={1} toFixed={0} />
      </Group>
    </div>
  );
};

export default ShapeProperties;
