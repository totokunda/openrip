import React, { useMemo, useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { collectCredits, creditLine, creditsText, requiredCredits } from "@/lib/credits";
import type { AssetCredit } from "@/lib/types";

/**
 * "Credits" on the Export dialog's finished screen: the openly licensed assets in the project
 * (stock videos and photos, music, sound effects), each with what a CC BY credit asks for (title,
 * author, licence, link), and one button copying them as text for a video's description. Nothing
 * at all when the project has none. Only assets still on the timeline count: a removed clip takes
 * its asset, and its credit, with it.
 */
export const ExportCredits: React.FC = () => {
  const assets = useClipStore((s) => s.assets);
  const credits = useMemo(() => collectCredits(assets), [assets]);
  const [copied, setCopied] = useState(false);
  if (credits.length === 0) return null;
  const text = creditsText(credits);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const required = requiredCredits(credits).length;
  return (
    <div data-testid="export-credits" data-count={credits.length} className="mt-4">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-semibold text-[#f2f2f2]">Credits</div>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="export-credits-copy"
          onClick={copy}
          className="h-[22px] px-2 rounded-[4px] bg-[#505056] hover:bg-[#5c5c63] text-[12px] text-[#e0e0e0] flex items-center gap-1.5 cursor-pointer"
        >
          {copied ? <LuCheck className="w-3.5 h-3.5" /> : <LuCopy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="text-[12px] text-[#a8a8a8] mt-1">
        {required > 0 ? "Paste this into your video's description: the CC BY items need it." : "None of these need a credit, but it's good manners."}
      </div>
      <ul className="mt-2 flex flex-col gap-1" data-testid="export-credits-list">
        {credits.map((c, i) => (
          <li key={`${c.id ?? c.title}-${i}`} data-testid="export-credit" data-kind={c.kind} data-required={c.attributionRequired ? "1" : "0"} className="rounded-[6px] bg-[#2f2f2f] px-3 py-1.5 text-[12px] text-[#cfcfcf] break-words" title={creditLine(c)}>
            <span className="font-semibold text-[#f2f2f2]">{c.title}</span>
            {c.author ? ` by ${c.author}` : ""} · {c.license}
          </li>
        ))}
      </ul>
      <textarea data-testid="export-credits-text" readOnly value={text} rows={6} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full resize-none rounded-[6px] bg-[#1c1c1c] px-3 py-2 text-[11px] leading-snug text-[#a8a8a8] outline-none" />
    </div>
  );
};

/** A clip's licence in the inspector: the licence, who made it, and where it's from. */
export const ClipLicense: React.FC<{ credit: AssetCredit }> = ({ credit }) => (
  <div data-testid="clip-license" data-required={credit.attributionRequired ? "1" : "0"} className="rounded-[6px] bg-[#2f2f2f] px-3 py-2 text-[12px] text-[#cfcfcf]">
    <div className="font-semibold text-[#f2f2f2] truncate" title={credit.title}>
      {credit.title}
    </div>
    {credit.author && <div className="truncate">by {credit.author}</div>}
    <div className="mt-1 text-[#a8a8a8]">
      {credit.licenseUrl ? (
        <a href={credit.licenseUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-white">
          {credit.license}
        </a>
      ) : (
        credit.license
      )}
      {credit.attributionRequired ? ": credit required (Export lists it)" : ": no credit required"}
    </div>
    {credit.sourceUrl ? (
      <a href={credit.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[#a8a8a8] underline decoration-dotted hover:text-white" title={credit.sourceUrl}>
        {credit.sourceName}: {credit.sourceUrl}
      </a>
    ) : (
      <div className="truncate text-[#a8a8a8]">{credit.sourceName}</div>
    )}
  </div>
);
