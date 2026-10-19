import React from "react";
import { LuChevronDown, LuChevronUp, LuSearch, LuX } from "react-icons/lu";
import { cancelAutoCaptions, refreshSpeechStatus, useAutoCaptions } from "@/lib/autocaptions";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { cutSpans, followClip, KEEP_PAUSE_SECS, targetPieces, transcribe, useTranscript, wordsOf } from "@/lib/transcript";
import { covers, fillerPositions, pauseSpans, paragraphs, spansOfWords, wordAt, wholeSpans, type ClipWord, type Span } from "@/lib/transcript-edit";
import { cn } from "@/lib/utils";

/**
 * Transcript, under Captions: the words a clip says (a local Whisper model, the same as Auto
 * captions; nothing is uploaded) as paragraphs to read and edit the video by. The word being
 * spoken is lit while it plays, a click seeks to a word, and a drag or Shift+click picks a
 * run of them for Delete, which cuts that part out of the clip (and its linked audio), closing
 * the main track up when the magnet is on, as one undo step. Remove filler words and Remove
 * pauses show what they would cut (struck through, with a count) before they are applied.
 * The logic is lib/transcript.ts; the mapping of words onto the timeline lib/transcript-edit.ts.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ").trim();

/** "1:05" or "0:07.3". */
const stamp = (frames: number, fps: number) => {
  const s = Math.max(0, frames / fps);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }> = ({ primary, className, ...props }) => (
  <button
    type="button"
    {...props}
    className={cn(
      "h-7 px-3 rounded-[4px] text-[13px] font-semibold disabled:opacity-50 shrink-0",
      primary ? "bg-brand-accent hover:brightness-110 text-white" : "bg-brand-background-light hover:bg-brand-button text-brand-lighter",
      className,
    )}
  />
);

const TranscriptMenu: React.FC = () => {
  const target = useTranscript((s) => s.target);
  const preview = useTranscript((s) => s.preview);
  const pauseSecs = useTranscript((s) => s.pauseSecs);
  const message = useTranscript((s) => s.message);
  const clips = useClipStore((s) => s.clips);
  const assets = useClipStore((s) => s.assets);
  const fps = useControlsStore((s) => s.fps) || 30;
  const selected = useControlsStore((s) => s.selectedClipIds);
  const speech = useAutoCaptions();
  const busy = speech.phase !== "idle";

  // The panel follows the clip selected (alone); it stays on the last one when the selection moves off video.
  React.useEffect(() => {
    if (selected.length === 1) followClip(useClipStore.getState().getClipById(selected[0]));
  }, [selected]);
  React.useEffect(() => {
    if (!speech.status) void refreshSpeechStatus();
  }, [speech.status]);

  const pieces = React.useMemo(() => targetPieces(clips, target), [clips, target]);
  const asset = target ? assets[target.assetId] : undefined;
  const transcript = asset?.transcript;
  const words = React.useMemo(() => wordsOf(pieces, transcript, fps), [pieces, transcript, fps]);
  const stale = !!transcript && pieces.some((c) => !covers(transcript, c, fps));
  const paras = React.useMemo(() => paragraphs(words, fps), [words, fps]);

  // What Remove filler words and Remove pauses would cut.
  const fillers = React.useMemo(() => new Set(fillerPositions(words)), [words]);
  const pauses = React.useMemo(
    () => pieces.flatMap((c) => pauseSpans(words.filter((w) => w.clipId === c.clipId), c, fps, pauseSecs, KEEP_PAUSE_SECS)),
    [pieces, words, fps, pauseSecs],
  );
  const pauseTotal = pauses.reduce((n, s) => n + (s.to - s.from), 0) / fps;
  // A pause is shown before the word that ends it (the end of a clip's after its last).
  const pauseBefore = React.useMemo(() => {
    const m = new Map<number, Span>();
    for (const p of pauses) {
      let i = words.findIndex((w) => w.clipId === p.clipId && w.from >= p.to - 1);
      if (i < 0) i = words.length;
      m.set(i, p);
    }
    return m;
  }, [pauses, words]);

  // Search.
  const [query, setQuery] = React.useState("");
  const [at, setAt] = React.useState(0);
  const matches = React.useMemo(() => {
    const qw = norm(query).split(" ").filter(Boolean);
    if (qw.length === 0) return [] as number[][];
    const flat = words.map((w) => norm(w.text));
    const out: number[][] = [];
    // A phrase: its words one after another, the last as far as typed.
    for (let i = 0; i + qw.length <= flat.length; i++) {
      if (qw.every((q, k) => (k === qw.length - 1 ? flat[i + k].includes(q) : flat[i + k] === q))) out.push(qw.map((_, k) => i + k));
    }
    return out;
  }, [query, words]);
  const matched = React.useMemo(() => new Set(matches.flat()), [matches]);
  const here = matches.length ? matches[Math.min(at, matches.length - 1)] : [];

  // Picking words: an anchor and a head, in the list's positions.
  const [pick, setPick] = React.useState<{ a: number; b: number } | null>(null);
  const dragging = React.useRef(false);
  const picked = React.useMemo(() => {
    const s = new Set<number>();
    if (pick) for (let i = Math.min(pick.a, pick.b); i <= Math.max(pick.a, pick.b); i++) s.add(i);
    return s;
  }, [pick]);
  React.useEffect(() => setPick(null), [target, words.length]);
  React.useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const seek = (w: ClipWord) => useControlsStore.getState().setFocusFrame(Math.round(w.from));
  const current = useControlsStore((s) => wordAt(words, s.focusFrame));
  const playing = useControlsStore((s) => s.isPlaying);

  const body = React.useRef<HTMLDivElement>(null);
  const scrollTo = (i: number) => body.current?.querySelector(`[data-word="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  React.useEffect(() => {
    if (playing && current >= 0) scrollTo(current);
  }, [current, playing]);
  React.useEffect(() => {
    if (here.length) {
      scrollTo(here[0]);
      seek(words[here[0]]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, matches]);

  const deletePicked = () => {
    if (picked.size === 0) return;
    cutSpans(spansOfWords(words, picked));
  };
  const apply = () => {
    if (preview === "fillers") cutSpans(spansOfWords(words, fillers));
    else if (preview === "pauses") cutSpans(pauses);
  };
  const previewing = (kind: "fillers" | "pauses") => useTranscript.setState({ preview: preview === kind ? null : kind });
  const previewSpans: Span[] = preview === "fillers" ? spansOfWords(words, fillers) : preview === "pauses" ? pauses : [];
  const previewCount = preview === "fillers" ? fillers.size : pauses.length;
  const cutSecs = wholeSpans(previewSpans, pieces).reduce((n, s) => n + (s.to - s.from), 0) / fps;

  const pct = Math.round(speech.progress * 100);
  const phaseLabel = speech.phase === "downloading" ? `Downloading the model ${pct}%` : `Transcribing ${pct}%`;
  const noEngine = !!speech.status && !speech.status.available;
  const [pauseText, setPauseText] = React.useState<string | null>(null);

  const progress = busy && (
    <div className="shrink-0 h-[52px] px-3 border-t border-brand-divider flex flex-row items-center justify-between gap-3">
      <div className="flex flex-col gap-1 flex-1 min-w-0" data-testid="transcript-progress" data-phase={speech.phase} data-progress={speech.progress.toFixed(3)}>
        <span className="text-[12px] text-brand-lighter">{phaseLabel}</span>
        <div className="h-1.5 rounded-full bg-[#3a3a3a] overflow-hidden">
          <div className="h-full bg-brand-accent" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      </div>
      <Button data-testid="transcript-cancel" onClick={cancelAutoCaptions}>
        Cancel
      </Button>
    </div>
  );

  // Nothing to show yet: pick a clip, or listen to it.
  if (!asset || pieces.length === 0 || !transcript) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="transcript" data-state={asset && pieces.length ? "empty" : "none"}>
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="text-[13px] font-semibold text-brand-lighter">Transcript</span>
          <p className="text-[12px] leading-snug text-[#949494]">
            {asset && pieces.length
              ? "Listens to the selected clip with a speech model on this computer, then lets you edit the clip by its words: nothing is uploaded."
              : "Select a video or audio clip on the timeline to see what it says."}
          </p>
          {asset && pieces.length > 0 && (
            <Button primary data-testid="transcript-start" disabled={busy || noEngine} onClick={() => void transcribe()}>
              Transcribe
            </Button>
          )}
          {noEngine && <p className="text-[12px] leading-snug text-[#c9a227]">This build of the engine can't recognize speech.</p>}
          {(message || speech.message) && (
            <p data-testid="transcript-message" className="text-[12px] leading-snug text-[#949494]">
              {message ?? speech.message}
            </p>
          )}
        </div>
        {progress}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="transcript" data-state="ready" data-words={words.length}>
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-brand-divider">
        <div className="flex flex-row items-center gap-2 h-7 rounded-[4px] bg-brand-background-light px-2">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="transcript-search"
            value={query}
            placeholder="Search the transcript"
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && matches.length) setAt((a) => (a + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-brand-lighter placeholder:text-[#6b6b6b]"
          />
          {query && (
            <>
              <span data-testid="transcript-matches" className="text-[11px] text-[#949494] shrink-0">
                {matches.length ? `${Math.min(at, matches.length - 1) + 1}/${matches.length}` : "0"}
              </span>
              <button type="button" aria-label="Previous match" disabled={!matches.length} onClick={() => setAt((a) => (a + matches.length - 1) % matches.length)}>
                <LuChevronUp className="w-3.5 h-3.5 text-brand-light" />
              </button>
              <button type="button" aria-label="Next match" disabled={!matches.length} onClick={() => setAt((a) => (a + 1) % matches.length)}>
                <LuChevronDown className="w-3.5 h-3.5 text-brand-light" />
              </button>
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <LuX className="w-3.5 h-3.5 text-brand-light" />
              </button>
            </>
          )}
        </div>

        <div className="flex flex-row items-center gap-2 flex-wrap">
          <Button data-testid="transcript-fillers" className={cn(preview === "fillers" && "ring-1 ring-brand-accent")} onClick={() => previewing("fillers")}>
            Remove filler words
          </Button>
          <Button data-testid="transcript-pauses" className={cn(preview === "pauses" && "ring-1 ring-brand-accent")} onClick={() => previewing("pauses")}>
            Remove pauses
          </Button>
          <label className="flex flex-row items-center gap-1 text-[12px] text-[#949494]">
            over
            <input
              data-testid="transcript-pause-secs"
              inputMode="decimal"
              value={pauseText ?? String(pauseSecs)}
              onChange={(e) => setPauseText(e.target.value)}
              onBlur={() => {
                const n = Number(pauseText);
                if (pauseText != null && Number.isFinite(n) && n > 0) useTranscript.setState({ pauseSecs: Math.min(30, Math.max(0.1, n)) });
                setPauseText(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-10 h-6 rounded-[4px] bg-brand-background-light text-center text-[12px] text-brand-lighter outline-none"
            />
            s
          </label>
        </div>

        {preview && (
          <div className="flex flex-row items-center justify-between gap-2 rounded-[4px] bg-brand-background-light px-2 py-1.5" data-testid="transcript-preview" data-kind={preview} data-count={previewCount}>
            <span className="text-[12px] text-brand-lighter">
              {previewCount === 0
                ? preview === "fillers"
                  ? "No filler words found"
                  : `No pauses over ${pauseSecs} s`
                : preview === "fillers"
                  ? `${previewCount} filler word${previewCount === 1 ? "" : "s"} · ${cutSecs.toFixed(1)} s`
                  : `${previewCount} pause${previewCount === 1 ? "" : "s"} · ${pauseTotal.toFixed(1)} s`}
            </span>
            <div className="flex flex-row gap-1.5">
              <Button primary data-testid="transcript-apply" disabled={previewCount === 0} onClick={apply} className="h-6 px-2.5 text-[12px]">
                Remove
              </Button>
              <Button data-testid="transcript-preview-cancel" onClick={() => useTranscript.setState({ preview: null })} className="h-6 px-2.5 text-[12px]">
                Cancel
              </Button>
            </div>
          </div>
        )}
        {stale && (
          <div className="flex flex-row items-center justify-between gap-2 rounded-[4px] bg-[#3a331d] px-2 py-1.5" data-testid="transcript-stale">
            <span className="text-[12px] text-[#e5cf8a]">The clip plays more than was transcribed.</span>
            <Button data-testid="transcript-refresh" disabled={busy} onClick={() => void transcribe()} className="h-6 px-2.5 text-[12px]">
              Refresh
            </Button>
          </div>
        )}
      </div>

      <div
        ref={body}
        tabIndex={0}
        data-testid="transcript-words"
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && picked.size) {
            e.preventDefault();
            e.stopPropagation();
            deletePicked();
          } else if (e.key === "Escape") setPick(null);
        }}
        className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-2 outline-none select-none"
      >
        {words.length === 0 && <p className="text-[12px] text-[#949494]">No speech found in what the clip plays.</p>}
        {paras.map((p) => (
          <div key={p.from} className="flex flex-row gap-2 py-1.5" data-testid="transcript-paragraph">
            <span className="w-8 shrink-0 pt-px text-[11px] text-[#6b6b6b] tabular-nums">{stamp(p.frame, fps)}</span>
            <p className="flex-1 min-w-0 text-left text-[13px] leading-[22px] text-brand-lighter">
              {words.slice(p.from, p.to + 1).map((w, k) => {
                const i = p.from + k;
                const cut = preview === "fillers" && fillers.has(i);
                const gap = pauseBefore.get(i);
                return (
                  <React.Fragment key={i}>
                    {preview === "pauses" && gap && (
                      <span data-testid="transcript-pause" className="mx-0.5 px-1 rounded-[3px] bg-[#4a2a2c] text-[11px] text-[#e5898c] line-through">
                        {((gap.to - gap.from) / fps).toFixed(1)}s
                      </span>
                    )}
                    <span
                      data-word={i}
                      data-testid="transcript-word"
                      data-text={w.text}
                      data-from={Math.round(w.from)}
                      data-current={current === i ? "true" : undefined}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        body.current?.focus({ preventScroll: true });
                        if (e.shiftKey && pick) setPick({ a: pick.a, b: i });
                        else {
                          dragging.current = true;
                          setPick({ a: i, b: i });
                        }
                        seek(w);
                      }}
                      onPointerEnter={() => {
                        if (dragging.current) setPick((s) => (s ? { a: s.a, b: i } : s));
                      }}
                      className={cn(
                        "cursor-pointer rounded-[3px] px-[2px] py-px hover:bg-brand-light/10",
                        current === i && "bg-brand-accent/35 text-white",
                        matched.has(i) && "bg-[#6b5a22]/70",
                        here.includes(i) && "ring-1 ring-brand-accent",
                        picked.has(i) && "bg-brand-accent/60 text-white",
                        cut && "text-[#e5898c] line-through bg-[#4a2a2c]",
                      )}
                    >
                      {w.text}
                    </span>{" "}
                  </React.Fragment>
                );
              })}
              {preview === "pauses" && p.to === words.length - 1 && pauseBefore.get(words.length) && (
                <span data-testid="transcript-pause" className="mx-0.5 px-1 rounded-[3px] bg-[#4a2a2c] text-[11px] text-[#e5898c] line-through">
                  {(() => {
                    const g = pauseBefore.get(words.length)!;
                    return `${((g.to - g.from) / fps).toFixed(1)}s`;
                  })()}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {progress || (
        <div className="shrink-0 min-h-[44px] px-3 border-t border-brand-divider flex flex-row items-center justify-between gap-3">
          <span className="text-[11px] leading-snug text-[#949494] min-w-0" data-testid="transcript-info">
            {message ?? (picked.size ? `${picked.size} word${picked.size === 1 ? "" : "s"} picked` : `${words.length} words · ${transcript.language} · ${transcript.model}`)}
          </span>
          <div className="flex flex-row gap-1.5 shrink-0">
            <Button primary data-testid="transcript-delete" disabled={picked.size === 0} onClick={deletePicked}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptMenu;
