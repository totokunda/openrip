import { createElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  LuArrowRight,
  LuDownload,
  LuRefreshCcw,
  LuSparkles,
} from "react-icons/lu";
import {
  type AppUpdateEvent,
  type AppUpdateState,
  checkForAppUpdates,
  downloadAppUpdate,
  getAppUpdateState,
  installAppUpdate,
  onAppUpdateEvent,
} from "@app/preload";
import { formatErrMessage } from "@/lib/formatErrMessage";

const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

function isAppUpdateRelevant(st: AppUpdateState | null | undefined): boolean {
  return st?.status === "available" || st?.status === "downloaded";
}

function safeSetLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function useUpdateToasts(): void {
  const lastShownRef = useRef<{ appKey: string | null }>({
    appKey: null,
  });

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let offApp: (() => void) | null = null;

    const showUpdateToast = (opts: {
      id: string;
      title: string;
      description: string;
      icon: "sparkles" | "download" | "refresh";
      actionLabel: string;
      onAction: () => void;
      onDismissClick?: () => void;
    }) => {
      toast.custom(
        () => {
          const iconNode =
            opts.icon === "download"
              ? createElement(LuDownload, { className: "h-[18px] w-[18px]" })
              : opts.icon === "refresh"
                ? createElement(LuRefreshCcw, { className: "h-[18px] w-[18px]" })
                : createElement(LuSparkles, { className: "h-[18px] w-[18px]" });

          return createElement(
            "div",
            { className: "w-full max-w-[420px] p-4 " },
            createElement(
              "div",
              { className: "flex items-start gap-3 " },
              createElement(
                "div",
                {
                  className:
                    "mt-0.5 shrink-0 rounded-md border border-white/10 bg-linear-to-br from-brand-accent-shade/30 via-brand-accent-shade/10 to-transparent p-2 text-brand-light",
                },
                iconNode,
              ),
              createElement(
                "div",
                { className: "min-w-0 flex-1" },
                createElement(
                  "div",
                  {
                    className:
                      "text-[12.5px] font-semibold tracking-tight text-brand-light",
                  },
                  opts.title,
                ),
                createElement(
                  "div",
                  {
                    className:
                      "mt-1 text-[10.5px] leading-snug text-brand-light/70",
                  },
                  opts.description,
                ),
                createElement(
                  "div",
                  { className: "mt-3 flex items-center justify-end gap-2" },
                  createElement(
                    "button",
                    {
                      type: "button",
                      className:
                        "h-8 rounded-[6px] border border-white/10 bg-white/5 px-3 text-[10.5px] font-medium text-brand-light/80 hover:bg-white/10",
                      onClick: () => {
                        try {
                          opts.onDismissClick?.();
                        } catch {
                          // ignore
                        }
                        toast.dismiss(opts.id);
                      },
                    },
                    "Dismiss",
                  ),
                  createElement(
                    "button",
                    {
                      type: "button",
                      className:
                        "h-8 rounded-[6px] bg-brand-accent-shade px-3 text-[10.5px] font-semibold text-brand-light hover:bg-brand-accent",
                      onClick: () => opts.onAction(),
                    },
                    createElement(
                      "span",
                      { className: "inline-flex items-center gap-1.5" },
                      opts.actionLabel,
                      createElement(LuArrowRight, { className: "h-3.5 w-3.5" }),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
        ({
          id: opts.id,
          duration: Infinity,
          important: true,
          dismissible: false,
          className:
            "!p-0 !text-start !shadow-xl !border !border-white/10 !bg-linear-to-br from-slate-950 via-black to-slate-900",
        } as any),
      );
    };

    const showAppToastFromState = (st: AppUpdateState, origin: "startup" | "event" | "reminder") => {
      if (!isAppUpdateRelevant(st)) return;
      const key = `${st.status}`;
      // Avoid spamming identical state changes except on startup/reminder.
      if (origin === "event" && lastShownRef.current.appKey === key) return;
      lastShownRef.current.appKey = key;
      safeSetLocalStorage("apex:lastShown:app-update", String(Date.now()));

      if (st.status === "downloaded") {
        showUpdateToast({
          id: "app-update-toast",
          title: "App update ready",
          description: "Restart OpenRip to apply the update.",
          icon: "sparkles",
          actionLabel: "Restart",
          onAction: () => {
            void installAppUpdate();
          },
        });
        return;
      }

      showUpdateToast({
        id: "app-update-toast",
        title: "App update available",
        description: "Download the update, then restart OpenRip to apply it.",
        icon: "download",
        actionLabel: "Download",
        onAction: () => {
          void downloadAppUpdate();
        },
      });
    };

    const refreshAndMaybeToast = async (origin: "startup" | "reminder") => {
      // Fetch the current snapshot first (fast), then run checks (slower) in the background.
      try {
        const st = await getAppUpdateState();
        if (!cancelled) showAppToastFromState(st, origin);
      } catch (e) {
      }

      // Kick checks to ensure we show on startup when updates exist.
      void (async () => {
        try {
          await checkForAppUpdates();
          const st = await getAppUpdateState();
          if (!cancelled) showAppToastFromState(st, origin);
        } catch (e) {
        }
      })();
    };

    void refreshAndMaybeToast("startup");

    offApp = onAppUpdateEvent((ev: AppUpdateEvent) => {
      if (cancelled) return;
      if (ev.type === "available" || ev.type === "downloaded" || ev.type === "not-available") {
        void (async () => {
          try {
            const st = await getAppUpdateState();
            showAppToastFromState(st, "event");
          } catch {}
        })();
        return;
      }
      if (ev.type === "error") {
        toast.error("App update error", {
          id: "app-update-toast-error",
          description: formatErrMessage(ev.message),
        });
      }
    });

    const reminderId = setInterval(() => {
      if (cancelled) return;
      void refreshAndMaybeToast("reminder");
    }, REMIND_EVERY_MS);

    return () => {
      cancelled = true;
      try {
        offApp?.();
      } catch {}
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearInterval(reminderId);
    };
  }, []);
}
