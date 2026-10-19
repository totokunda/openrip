import React, { useMemo, useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { creditLine, creditsText, licenseLabel, needsCredit, projectCredits } from "@/lib/music-credits";
import type { AssetCredit } from "@/lib/types";

/**
 * "Audio credits": the library tracks (Music, Sound effects) on the timeline, each with what a
 * CC BY credit asks for (title, author, licence, link), and one button copying them as text for
 * a video's description. Nothing at all when the project has none. Only tracks still on the
 * timeline count: a removed clip takes its asset, and its credit, with it.
 */
export const AudioCredits: React.FC = () => {
  const assets = useClipStore((s) => s.assets);
  const credits = useMemo(() => projectCredits(assets), [assets]);
  const [copied, setCopied] = useState(false);
  if (credits.length === 0) return null;
  const text = creditsText(credits);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const required = credits.filter(needsCredit).length;
  return (
    <div data-testid="audio-credits" data-count={credits.length} className="mt-4">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-semibold text-[#f2f2f2]">Audio credits</div>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="audio-credits-copy"
          onClick={copy}
          className="h-[22px] px-2 rounded-[4px] bg-[#505056] hover:bg-[#5c5c63] text-[12px] text-[#e0e0e0] flex items-center gap-1.5 cursor-pointer"
        >
          {copied ? <LuCheck className="w-3.5 h-3.5" /> : <LuCopy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="text-[12px] text-[#a8a8a8] mt-1">
        {required > 0 ? "Paste this into your video's description: the CC BY tracks need it." : "None of these tracks need a credit, but it's good manners."}
      </div>
      <ul className="mt-2 flex flex-col gap-1" data-testid="audio-credits-list">
        {credits.map((c) => (
          <li key={c.id} data-testid="audio-credit" data-license={c.license} className="rounded-[6px] bg-[#2f2f2f] px-3 py-1.5 text-[12px] text-[#cfcfcf] break-words" title={creditLine(c)}>
            <span className="font-semibold text-[#f2f2f2]">{c.title}</span> by {c.author} · {licenseLabel(c)}
          </li>
        ))}
      </ul>
      <textarea data-testid="audio-credits-text" readOnly value={text} rows={6} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full resize-none rounded-[6px] bg-[#1c1c1c] px-3 py-2 text-[11px] leading-snug text-[#a8a8a8] outline-none" />
    </div>
  );
};

/** A clip's licence in the audio inspector: the licence, who made it, and where it's from. */
export const ClipLicense: React.FC<{ credit: AssetCredit }> = ({ credit }) => (
  <div data-testid="clip-license" data-license={credit.license} className="rounded-[6px] bg-[#2f2f2f] px-3 py-2 text-[12px] text-[#cfcfcf]">
    <div className="font-semibold text-[#f2f2f2] truncate" title={credit.title}>
      {credit.title}
    </div>
    <div className="truncate">by {credit.author}</div>
    <div className="mt-1 text-[#a8a8a8]">
      <a href={credit.licenseUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-white">
        {licenseLabel(credit)}
      </a>
      {needsCredit(credit) ? ": credit required (Export lists it)" : ": no credit required"}
    </div>
    <a href={credit.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[#a8a8a8] underline decoration-dotted hover:text-white" title={credit.sourceUrl}>
      {credit.sourceUrl}
    </a>
  </div>
);
