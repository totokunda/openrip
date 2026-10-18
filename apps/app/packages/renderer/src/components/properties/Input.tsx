import { cn } from "@/lib/utils";
import { preferences } from "@/lib/preferences";
import React, { useEffect, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { LuInfo } from "react-icons/lu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InputProps<T> {
  className?: string;
  stepClassName?: string;
  label?: string;
  description?: string;
  value: T;
  onChange: (value: T) => void;
  startLogo?: string;
  canStep?: boolean;
  step?: number;
  max?: number;
  min?: number;
  emptyLabel?: boolean;
}

const Input: React.FC<InputProps<string>> = ({
  value,
  onChange,
  label,
  description,
  className,
  stepClassName,
  startLogo,
  canStep,
  step,
  max,
  min,
  emptyLabel,
}) => {
  const [tempValue, setTempValue] = useState(value);
  const lastValueRef = React.useRef(value);

  useEffect(() => {
    setTempValue(value);
    lastValueRef.current = value;
  }, [value]);

  const handleBlur = () => {
    if (tempValue === value) return; // No change, skip
    const oldValue = lastValueRef.current;
    onChange(tempValue);

    // Check if change was accepted by seeing if value prop changed
    requestAnimationFrame(() => {
      // Schedule another check to see if parent updated the value
      requestAnimationFrame(() => {
        if (lastValueRef.current === oldValue) {
          // Value didn't change, reset to current value
          setTempValue(lastValueRef.current);
        }
      });
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (tempValue !== value) {
        const oldValue = lastValueRef.current;
        onChange(tempValue);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (lastValueRef.current === oldValue) {
              setTempValue(lastValueRef.current);
            }
          });
        });
      }
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setTempValue(value);
      e.currentTarget.blur();
    } else if (canStep && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // A step, or Settings › Edit › Adjust value many with ⇧.
      const numValue = Number(value);
      if (isNaN(numValue) || !isFinite(numValue)) return;
      e.preventDefault();
      const unit = step && step > 0 ? step : 1;
      const by = (e.shiftKey ? unit * Math.max(1, preferences().adjustUnits) : unit) * (e.key === "ArrowUp" ? 1 : -1);
      onChange(String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number((numValue + by).toFixed(6))))));
    }
  };

  return (
    <div className="flex flex-col items-start w-full gap-y-1 min-w-0">
      {(label || description || emptyLabel) && (
        <div className="flex items-center gap-1.5 w-full text-start mb-0.5">
          {(label || emptyLabel) && (
            <label className={cn("text-brand-light text-[12px]", {
              "text-transparent": emptyLabel,
            })}>
              {emptyLabel ? "Empty" : label}
            </label>
          )}
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-brand-light/70 hover:text-brand-light focus:outline-none"
                >
                  <LuInfo className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                sideOffset={6}
                className="max-w-xs whitespace-pre-wrap text-[10px] font-poppins bg-brand-background border border-brand-light/10"
              >
                {description}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    
      <div className="relative w-full flex flex-row items-center min-w-0">
        {startLogo && (
          <span className="text-[#949494] text-[12px] absolute left-2 top-1/2 -translate-y-1/2">
            {startLogo}
          </span>
        )}
        <input
          className={cn(
            `w-full h-[22px] px-1.5 text-brand-lighter text-[12px] tabular-nums font-normal items-center p-1 rounded-[4px] bg-brand ${className}`,
            {
              "pl-6": startLogo,
            },
          )}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        {canStep && (
          <div className={cn("ml-0.5 flex flex-col items-center w-4 justify-center bg-brand-background-light h-[22px] cursor-pointer rounded-[3px]", stepClassName)}>
            <button
              className="w-full h-full px-1 hover:bg-brand-light/10 transition-all duration-200 flex items-center justify-center rounded-tr"
              onClick={() => {
                const numValue = Number(value);
                if (isNaN(numValue) || !isFinite(numValue)) return;
                const changedValue = Math.min(
                  numValue + (step ?? 0),
                  max ?? numValue + (step ?? 0),
                );
                onChange(changedValue.toString());
              }}
            >
              <LuChevronUp className="w-2 h-2 cursor-pointer text-brand-light" />
            </button>
            <button
              className="w-full h-full px-1 hover:bg-brand-light/10 transition-all duration-200 flex items-center justify-center rounded-br"
              onClick={() => {
                const numValue = Number(value);
                if (isNaN(numValue) || !isFinite(numValue)) return;
                const changedValue = Math.max(
                  numValue - (step ?? 0),
                  min ?? numValue - (step ?? 0),
                );
                onChange(changedValue.toString());
              }}
            >
              <LuChevronDown className="w-2 h-2 cursor-pointer text-brand-light" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Input;
