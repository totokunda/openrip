import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cancelAnalysis, useAnalysisStore, type AnalysisKind } from "@/lib/analysis";

const LABEL: Record<AnalysisKind, string> = { scenes: "Splitting scenes", auto: "Auto adjust", match: "Color match", consistent: "Matching colors", motion: "Analysing motion" };

/**
 * CapCut's processing pill, in the middle of the timeline while the engine reads a clip
 * (lib/analysis.ts): a ring filling with the progress, and Cancel, which stops it with nothing
 * changed.
 */
const AnalysisPill: React.FC = () => {
  const running = useAnalysisStore((s) => s.running);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!running) return;
    const measure = () => setBox(document.querySelector("[data-testid=timeline]")?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [!!running]);
  if (!running || !box) return null;
  const r = 9;
  const ring = 2 * Math.PI * r;
  return createPortal(
    <div
      data-testid="analysis-pill"
      title={`${LABEL[running.kind]} ${Math.round(running.progress * 100)}%`}
      style={{ position: "fixed", left: box.left + box.width / 2, top: box.top + box.height / 2, transform: "translate(-50%, -50%)", zIndex: 90 }}
      className="h-[45px] px-4 rounded-[8px] bg-[#5b5b5b]/95 shadow-[0_4px_16px_rgba(0,0,0,0.4)] flex flex-row items-center gap-2.5 select-none"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
        <circle cx="11" cy="11" r={r} fill="none" stroke="#ae81ce" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${ring * Math.max(0.03, running.progress)} ${ring}`} transform="rotate(-90 11 11)" />
      </svg>
      <button type="button" data-testid="analysis-cancel" onClick={cancelAnalysis} className="text-[15px] text-white hover:text-brand-lighter">
        Cancel
      </button>
    </div>,
    document.body,
  );
};

export default AnalysisPill;
