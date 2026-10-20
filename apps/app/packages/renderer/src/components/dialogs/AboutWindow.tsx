// The About window, laid out as CapCut's (00-menu-bar/001-about.png): a small window with its
// title, the app's mark with the version beside it, the name, a rule, and the copyright line.
// The mark is OpenRip's own (the home screen's clapperboard on the lavender gradient).
import React, { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import AppLogo from "@/components/common/AppLogo";
import { getAppInfo, type AppInfo } from "@app/preload";
import { useT } from "@/lib/i18n";
import { useShellStore } from "@/lib/shell";

export const AboutWindow: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const t = useT();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    if (open && !info) void getAppInfo().then(setInfo).catch(() => {});
  }, [open, info]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <DialogPrimitive.Content
          data-testid="about-window"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[338px] rounded-[12px] border border-[#3c3c3c] bg-brand-background shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none overflow-hidden"
        >
          <div className="relative h-[34px] bg-brand-header flex items-center justify-center border-b border-black/60">
            <button type="button" aria-label="Close" data-testid="about-close" onClick={() => onOpenChange(false)} className="absolute left-3 h-3 w-3 rounded-full bg-[#ff5f57] hover:brightness-110 cursor-pointer" />
            <DialogPrimitive.Title className="text-[12px] font-semibold text-brand-lighter">{t("about.title")}</DialogPrimitive.Title>
          </div>
          <div className="flex flex-col items-center pt-6 pb-5 px-6">
            <div className="relative">
              <AppLogo size={64} className="block" />
              <span data-testid="about-version" className="absolute -top-2 left-[52px] h-[18px] px-1.5 rounded-full bg-brand-accent text-[11px] font-semibold text-white leading-[18px] whitespace-nowrap">
                {info ? t("about.version", { version: info.version }) : "…"}
              </span>
            </div>
            <div className="mt-2.5 text-[15px] font-semibold text-brand-lighter">{info?.name ?? "OpenRip"}</div>
            <div className="mt-1 text-[11px] text-[#9a9a9a]">{t("about.tagline")}</div>
            <div className="w-full h-px bg-brand-divider my-5" />
            <div className="text-[11px] text-[#7a7a7a] text-center leading-[16px]">
              {info ? `Electron ${info.electron} · Chromium ${info.chrome.split(".")[0]} · ${info.platform}-${info.arch}` : ""}
            </div>
            <button
              type="button"
              data-testid="about-notices"
              onClick={() => {
                onOpenChange(false);
                useShellStore.getState().setNoticesOpen(true);
              }}
              className="mt-2 text-[11px] text-brand-accent hover:underline cursor-pointer"
            >
              {t("about.notices")}
            </button>
            <div className="mt-4 text-[12px] text-brand-light">{t("about.copyright", { year: new Date().getFullYear() })}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default AboutWindow;
