import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useState, useEffect } from "react";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center group/slider",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-brand-hover">
      <SliderPrimitive.Range className="absolute h-full bg-brand-lighter" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3 w-2 rounded-[2px] bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

interface PropertiesSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  renderInput?: (value: number | string) => string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  toFixed?: number;
  labelClass?: string;
  inputClass?: string;
  buttonClass?: string;
  disabled?: boolean;
}

const PropertiesSlider: React.FC<PropertiesSliderProps> = ({
  label,
  value,
  onChange,
  renderInput,
  suffix,
  min,
  max,
  step = 0,
  toFixed = 1,
  labelClass,
  inputClass,
  buttonClass,
  disabled = false,
}) => {
  const [tempValue, setTempValue] = useState(value.toFixed(toFixed));
  const [isFocused, setIsFocused] = useState(false);
  const lastValueRef = React.useRef(value);

  useEffect(() => {
    setTempValue(value.toFixed(toFixed));
    lastValueRef.current = value;
  }, [value, renderInput]);

  const handleBlur = () => {
    setIsFocused(false);
    // remove all non-numeric characters (keeping a minus sign)
    const numericValue = tempValue.replace(/[^0-9.-]/g, "");
    const numValue = Number(numericValue);
    const currentDisplay = value.toFixed(toFixed);
    if (tempValue === currentDisplay) return; // No change, skip

    if (!isNaN(numValue) && isFinite(numValue)) {
      const oldValue = lastValueRef.current;
      onChange(numValue);

      // Check if change was accepted by seeing if value prop changed
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (lastValueRef.current === oldValue) {
            // Value didn't change, reset to current value
            setTempValue(lastValueRef.current.toString());
          }
        });
      });
    } else {
      // Invalid input, reset
      setTempValue(currentDisplay);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const numValue = Number(tempValue);
      const currentDisplay = value.toString();

      if (
        tempValue !== currentDisplay &&
        !isNaN(numValue) &&
        isFinite(numValue)
      ) {
        const oldValue = lastValueRef.current;
        onChange(numValue);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (lastValueRef.current === oldValue) {
              setTempValue(lastValueRef.current.toString());
            }
          });
        });
      }
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setTempValue(value.toString());
      e.currentTarget.blur();
    }
  };

  return (
    <div className="flex flex-col items-start w-full min-w-0">
      <label
        className={cn(
          "text-brand-light text-[12px] mb-1",
          labelClass,
        )}
      >
        {label}
      </label>
      <div className="flex flex-row items-center gap-x-2.5 w-full min-w-0">
        <Slider
          value={[value]}
          onValueChange={(value) => onChange(value[0])}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <div className="flex flex-row items-center">
          <input
            className={cn(
              "w-[54px] h-[22px] px-1.5 text-center text-brand-lighter text-[12px] tabular-nums font-normal items-center p-1 rounded-[4px] bg-brand",
              inputClass,
              disabled && "opacity-50 cursor-not-allowed",
            )}
            value={
              renderInput
                ? renderInput(tempValue)
                : isFocused
                  ? tempValue
                  : tempValue + (suffix || "")
            }
            onChange={(e) => setTempValue(e.target.value)}
            onFocus={() => !disabled && setIsFocused(true)}
            onBlur={disabled ? undefined : handleBlur}
            onKeyDown={disabled ? undefined : handleKeyDown}
            readOnly={disabled}
          />
          <div
            className={cn(
              "ml-0.5 w-4 flex flex-col items-center justify-center bg-brand-background-light h-[22px] rounded-[3px]",
              buttonClass,
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <button
              className="w-full h-full px-1 hover:bg-brand-light/10 transition-all duration-200"
              disabled={disabled}
              onClick={() => {
                if (!disabled && !isNaN(value) && isFinite(value))
                  onChange(Math.min(value + step, max ?? value + step));
              }}
            >
              <LuChevronUp className="w-2 h-2 cursor-pointer text-brand-light" />
            </button>
            <button
              className="w-full h-full px-1 hover:bg-brand-light/10 transition-all duration-200"
              disabled={disabled}
              onClick={() => {
                if (!disabled && !isNaN(value) && isFinite(value))
                  onChange(Math.max(value - step, min ?? value - step));
              }}
            >
              <LuChevronDown className="w-2 h-2 cursor-pointer text-brand-light" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertiesSlider;
