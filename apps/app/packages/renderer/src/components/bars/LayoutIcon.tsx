import React from "react";

type LayoutType = "default" | "media" | "properties" | "vertical";

interface LayoutIconProps {
  type: LayoutType;
  className?: string;
}

const rectClass = " h-full w-full  border-brand-light";

export const LayoutIcon: React.FC<LayoutIconProps> = ({ type, className }) => {
  return (
    <div
      className={`h-5 w-5 rounded-[2px] border-[1.5px] border-brand-light overflow-hidden ${className ?? "scale-75"}`}
    >
      {type === "default" && (
        <>
          <div className="grid grid-cols-3 grid-rows-3 gap-0 h-full w-full">
            <div className="row-span-2">
              <div className={`${rectClass} border-r-[1.5px]`}></div>
            </div>
            <div className="row-span-2">
              <div className={`${rectClass} border-r-[1.5px]`}></div>
            </div>
            <div className="row-span-2">
              <div className={`${rectClass}`}></div>
            </div>
            <div className="col-span-3 row-start-3">
              <div className={`${rectClass} border-t-[1.5px]`}></div>
            </div>
          </div>
        </>
      )}
      {type === "media" && (
        <>
          <div className="grid grid-cols-3 grid-rows-3 gap-0 h-full w-full">
            <div className="col-start-1 col-span-1 row-start-1 row-span-3">
              <div className={`${rectClass} border-r-[1.5px]`}></div>
            </div>
            <div className="col-start-2 col-span-1 row-start-1 row-span-2">
              <div className={`${rectClass} border-r-[1.5px]`}></div>
            </div>
            <div className="col-start-3 col-span-1 row-start-1 row-span-2">
              <div className={`${rectClass}`}></div>
            </div>
            <div className="col-start-2 col-span-2 row-start-3 row-span-1">
              <div className={`${rectClass} border-t-[1.5px]`}></div>
            </div>
          </div>
        </>
      )}
      {(type === "properties" || type === "vertical") && (
        <>
          <div className="grid grid-cols-3 grid-rows-3 gap-0 h-full w-full">
            <div className="col-start-3 col-span-1 row-start-1 row-span-3">
              <div className={`${rectClass} border-l-[1.5px] flex items-center justify-center`}>
                {/* Vertical: the full-height column is the player, a portrait frame in it. */}
                {type === "vertical" && <div className="w-[3px] h-[6px] border border-brand-light rounded-[1px]" />}
              </div>
            </div>
            <div className="col-start-1 col-span-1 row-start-1 row-span-2">
              <div className={`${rectClass} border-r-[1.5px]`}></div>
            </div>
            <div className="col-start-2 col-span-1 row-start-1 row-span-2">
              <div className={`${rectClass}`}></div>
            </div>
            <div className="col-start-1 col-span-2 row-start-3 row-span-1">
              <div className={`${rectClass} border-t-[1.5px]`}></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LayoutIcon;
