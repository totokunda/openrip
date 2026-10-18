import React from "react";
import { useKeyedProperty } from "@/lib/keyframe-ui";
import type { KeyframeProperty } from "@/lib/types";
import KeyframeButton from "./KeyframeButton";
import PropertiesSlider from "./PropertiesSlider";

/**
 * A label-over-slider row for one keyframeable property of a clip: it shows the value at the
 * playhead (the keys' while it has any), an edit sets the key there while the property is
 * keyed and the field otherwise (CapCut's rule, `editProperty`), and the navigator at its end
 * keys it. `shown`/`stored` convert between the field's units and the row's (a scale of 1 is
 * 100 %).
 */
const KeyframedSlider: React.FC<{
  clipId: string;
  property: KeyframeProperty;
  label: string;
  min: number;
  max: number;
  step?: number;
  toFixed?: number;
  suffix?: string;
  origin?: number;
  track?: string;
  disabled?: boolean;
  shown?: (v: number) => number;
  stored?: (v: number) => number;
}> = ({ clipId, property, label, min, max, step = 1, toFixed = 0, suffix, origin, track, disabled, shown = (v) => v, stored = (v) => v }) => {
  const { value, set } = useKeyedProperty(clipId, property);
  const v = Number(Array.isArray(value) ? value[0] : (value ?? 0));
  return (
    <div data-property={property} className="min-w-0">
      <PropertiesSlider
        label={label}
        value={Number.isFinite(v) ? shown(v) : 0}
        onChange={(n) => Number.isFinite(n) && set(stored(Math.min(max, Math.max(min, n))))}
        min={min}
        max={max}
        step={step}
        toFixed={toFixed}
        suffix={suffix}
        origin={origin}
        track={track}
        disabled={disabled}
        end={<KeyframeButton clipId={clipId} properties={[property]} disabled={disabled} />}
      />
    </div>
  );
};

export default KeyframedSlider;
