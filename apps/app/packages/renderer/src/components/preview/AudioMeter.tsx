import React, { useEffect, useRef, useState } from "react";
import { engineOutputLevels } from "@app/preload";
import { useControlsStore } from "@/lib/control";
import { useEngineDraws } from "@/lib/engine-preview";

/**
 * The player's stereo level meter, after its time as in CapCut: two columns of five bars,
 * 22×16. Grey while nothing plays; playing, the bars up to the mix's level light green. The
 * level is the engine's: the peak of what its mixer played since the last look (before the
 * output volume), asked for 20 times a second while playing, falling back gently.
 */

/** The level (dBFS) each bar lights at, bottom to top. */
const BARS_DB = [-42, -30, -20, -11, -4];
const IDLE = "#373636";
const LIT = "#4cc764";
/** How fast the shown level falls, dB a second. */
const FALL_DB = 36;

const toDb = (peak: number) => (peak > 1e-5 ? 20 * Math.log10(peak) : -120);

const AudioMeter: React.FC<{ off?: boolean }> = ({ off }) => {
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const draws = useEngineDraws();
  const [db, setDb] = useState<[number, number]>([-120, -120]);
  const shown = useRef<[number, number]>([-120, -120]);
  const last = useRef(0);

  useEffect(() => {
    if (!isPlaying || !draws) {
      shown.current = [-120, -120];
      setDb([-120, -120]);
      return;
    }
    let stop = false;
    last.current = performance.now();
    // Clear what built up while paused.
    void engineOutputLevels();
    const tick = async () => {
      const levels = await engineOutputLevels().catch(() => null);
      if (stop) return;
      const now = performance.now();
      const fall = (FALL_DB * (now - last.current)) / 1000;
      last.current = now;
      const next: [number, number] = [
        Math.max(toDb(levels?.left ?? 0), shown.current[0] - fall),
        Math.max(toDb(levels?.right ?? 0), shown.current[1] - fall),
      ];
      shown.current = next;
      setDb(next);
    };
    const id = setInterval(() => void tick(), 50);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [isPlaying, draws]);

  const lit = (v: number) => (isPlaying && !off ? BARS_DB.filter((t) => v >= t).length : 0);
  const [l, r] = [lit(db[0]), lit(db[1])];
  const column = (n: number, x: number) =>
    BARS_DB.map((_, i) => <rect key={i} x={x} y={14 - i * 3.5} width={9} height={2} rx={0.6} fill={i < n ? LIT : IDLE} />);
  return (
    <svg
      viewBox="0 0 21 16"
      width={21}
      height={16}
      data-testid="audio-meter"
      data-left={db[0].toFixed(1)}
      data-right={db[1].toFixed(1)}
      data-lit={`${l},${r}`}
      aria-label="Audio level"
      className="shrink-0"
    >
      {column(l, 0)}
      {column(r, 12)}
    </svg>
  );
};

export default AudioMeter;
