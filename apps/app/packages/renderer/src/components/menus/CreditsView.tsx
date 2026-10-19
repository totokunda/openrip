import React, { useMemo, useState } from "react";
import { LuAward, LuCopy, LuExternalLink } from "react-icons/lu";
import { toast } from "sonner";
import { openCreditUrl } from "@app/preload";
import { useClipStore } from "@/lib/clip";
import { collectCredits, creditsSummary, creditsText, requiredCredits } from "@/lib/credits";
import type { AssetCredit } from "@/lib/types";
import { cn } from "@/lib/utils";

const Link: React.FC<{ href?: string; children: React.ReactNode; testId?: string }> = ({ href, children, testId }) =>
  href ? (
    <button type="button" data-testid={testId} onClick={() => void openCreditUrl(href)} title={href} className="inline-flex items-center gap-0.5 text-brand-accent hover:underline cursor-pointer text-left">
      {children}
      <LuExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
    </button>
  ) : (
    <span>{children}</span>
  );

/**
 * The project's credits, listed once for every kind of openly licensed asset: each asset carries
 * its attribution (`asset.credit`, lib/credits.ts), and this view reads them all from the open
 * project. CC BY items need credit and are marked; Copy puts the text for a video's description
 * on the clipboard. Used by the Media tab's Library (and the Audio tab for its music).
 */
const CreditsView: React.FC = () => {
  const assets = useClipStore((s) => s.assets);
  const list = useMemo(() => collectCredits(assets), [assets]);
  const [onlyRequired, setOnlyRequired] = useState(false);
  const shown = onlyRequired ? requiredCredits(list) : list;
  const text = creditsText(list, onlyRequired);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Credits copied", { position: "bottom-right", duration: 2000 });
    } catch {
      toast.error("The credits couldn't be copied", { position: "bottom-right", duration: 3000 });
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="credits-view">
      <div className="px-3.5 pt-3 pb-2 shrink-0 flex flex-col gap-2 text-left">
        <h3 className="text-[12.5px] text-brand-light leading-none">Asset credits</h3>
        <p className="text-[11px] leading-snug text-brand-light/55" data-testid="credits-summary">
          {creditsSummary(list)}
        </p>
        {list.length > 0 && (
          <div className="flex items-center gap-2">
            <button type="button" data-testid="credits-copy" onClick={() => void copy()} className="h-7 px-2.5 rounded-[6px] text-[11px] flex items-center gap-1.5 text-brand-light/90 bg-brand hover:bg-brand-background-light cursor-pointer">
              <LuCopy className="w-3 h-3" /> Copy credits
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-brand-light/70 cursor-pointer select-none">
              <input type="checkbox" data-testid="credits-required" checked={onlyRequired} onChange={(e) => setOnlyRequired(e.target.checked)} className="accent-[#ae81ce]" />
              Only the ones that need credit
            </label>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-6">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="credits-empty">
            <LuAward className="w-6 h-6 text-brand-light/35" />
            <p className="text-[11px] leading-relaxed text-brand-light/50 max-w-[260px]">Videos and photos from the Library, and music from the Audio tab, are listed here with their authors and licences once they're in the project.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((c: AssetCredit, i) => (
              <li key={`${c.title}-${i}`} data-testid="credit-row" data-kind={c.kind} data-required={c.attributionRequired ? "1" : "0"} className="rounded-[6px] bg-brand-background-light px-2.5 py-2 text-left text-[11px] leading-snug">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-brand-light truncate" title={c.title}>
                    {c.title}
                  </span>
                  <span className={cn("shrink-0 px-1.5 h-[15px] rounded-[3px] text-[9.5px] leading-[15px]", c.attributionRequired ? "bg-brand-accent text-black" : "bg-white/10 text-brand-light/70")}>{c.attributionRequired ? "Credit needed" : "No credit needed"}</span>
                </div>
                <div className="text-brand-light/60 mt-0.5">
                  by <Link href={c.authorUrl}>{c.author || "Unknown author"}</Link>
                </div>
                <div className="text-brand-light/60 flex flex-wrap gap-x-1.5">
                  <Link href={c.licenseUrl} testId="credit-licence">
                    {c.license}
                  </Link>
                  <span>·</span>
                  <Link href={c.sourceUrl}>{c.sourceName}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CreditsView;
