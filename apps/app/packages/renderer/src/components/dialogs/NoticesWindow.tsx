// The open-source notices, laid out as CapCut's Third-party copyright window
// (31-dialogs/006-third-party-copyright.png): a window with a white page of notices. They are
// OpenRip's own, made from its lockfiles (npm and Cargo) when the app is built
// (scripts/third-party-notices.mjs): each licence text once, after the packages it covers.
import React, { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { getThirdPartyNotices, type ThirdPartyNotices } from "@app/preload";
import { useT } from "@/lib/i18n";
import { OPENH264_BINARY_LICENSE } from "@/lib/openh264";

export const NoticesWindow: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const t = useT();
  const [notices, setNotices] = useState<ThirdPartyNotices | null | undefined>(undefined);
  useEffect(() => {
    if (open && notices === undefined) void getThirdPartyNotices().then(setNotices).catch(() => setNotices(null));
  }, [open, notices]);
  const count = notices ? notices.licenses.reduce((n, l) => n + l.packages.length, 0) : 0;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <DialogPrimitive.Content
          data-testid="notices-window"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[960px] max-w-[calc(100vw-48px)] h-[720px] max-h-[calc(100vh-48px)] flex flex-col rounded-[12px] border border-[#3c3c3c] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none overflow-hidden"
        >
          <div className="relative h-[35px] shrink-0 bg-brand-header flex items-center justify-center">
            <button type="button" aria-label="Close" data-testid="notices-close" onClick={() => onOpenChange(false)} className="absolute left-3 h-3 w-3 rounded-full bg-[#ff5f57] hover:brightness-110 cursor-pointer" />
            <DialogPrimitive.Title className="text-[12px] font-semibold text-brand-lighter">{t("notices.title")}</DialogPrimitive.Title>
          </div>
          <div data-testid="notices-page" data-packages={count || undefined} className="flex-1 overflow-y-auto bg-white text-[#1c1c1c] select-text">
            <div className="max-w-[700px] mx-auto py-8 px-6 text-left text-[14px] leading-[22px]">
              <h1 className="text-[17px] font-semibold mb-3">{t("notices.heading")}</h1>
              <p className="mb-3">{t("notices.intro")}</p>
              <p className="mb-3">{t("notices.ffmpeg")}</p>
              <section data-testid="notices-openh264" className="mb-6">
                <p className="mb-2">{t("notices.openh264")}</p>
                <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[17px] text-[#333] bg-[#f6f6f6] rounded-[6px] p-3">{OPENH264_BINARY_LICENSE}</pre>
              </section>
              {notices === undefined && <p>{t("notices.loading")}</p>}
              {notices === null && <p data-testid="notices-missing">{t("notices.missing")}</p>}
              {notices?.licenses.map((l, i) => (
                <section key={i} data-testid="notices-license" className="mb-8">
                  <h2 className="text-[15px] font-semibold mb-1">{l.id}</h2>
                  <p className="mb-2 text-[13px] text-[#444]">
                    {l.packages.map((p) => `${p.name} ${p.version}${p.source === "cargo" ? " (Cargo)" : p.source === "npm" ? " (npm)" : p.source === "bundled" ? " (bundled)" : ""}`).join(", ")}
                  </p>
                  {l.text ? <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[17px] text-[#333] bg-[#f6f6f6] rounded-[6px] p-3">{l.text}</pre> : null}
                </section>
              ))}
              {notices && <p className="text-[12px] text-[#777]">{t("notices.packages", { n: count })} · {notices.generatedAt}</p>}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default NoticesWindow;
