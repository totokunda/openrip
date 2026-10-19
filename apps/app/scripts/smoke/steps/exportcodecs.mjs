// The Export dialog's extra codecs (after `import timeline`; `~/Downloads/IMG_9079.MOV` with
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1; docs/plan/capcut-ui-spec.md §6.29): the Codec menu
// lists ProRes 422 LT / 422 / 422 HQ / 4444 and HEVC with alpha where the platform encoder has
// them (the engine's exportCodecs); choosing one makes the Format a .mov (the menu greyed) and
// greys the Bit rate (ProRes has its own); the footer's size follows the profile; then real
// 480P exports read back with ffprobe (FFPROBE=, default /opt/homebrew/bin/ffprobe): ProRes 422,
// 422 HQ, LT and 4444 in a .mov with their profiles, HEVC with alpha in a .mov tagged hvc1 that
// AVFoundation decodes (fixtures/alpha.swift, when swiftc is there), and a plain HEVC mp4 still
// tagged hvc1 and decoding.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checks } from "./_anim.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const probe = (file) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 26 }).toString());
const here = path.dirname(fileURLToPath(import.meta.url));

export default async (ctx) => {
  const { app, win, shot, outDir, fs } = ctx;
  const { check, report } = checks();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const finish = async () => {
    for (let i = 0; i < 600; i++) {
      const phase = await T("export-run").getAttribute("data-phase").catch(() => null);
      if (phase && phase !== "running") return phase;
      await win.waitForTimeout(500);
    }
    throw new Error("export never ended");
  };
  const choose = async (id, label) => {
    await T(id).scrollIntoViewIfNeeded();
    await T(id).click();
    await win.waitForTimeout(250);
    await win.locator(`[data-testid=${id}-option]`).filter({ hasText: label }).first().click();
    await win.waitForTimeout(250);
  };
  const estimate = async () => +(await T("export-estimate").getAttribute("data-bytes"));
  const exportAs = async (codecLabel, name) => {
    await choose("export-codec", codecLabel);
    await T("export-name").fill(name);
    await T("export-path").fill(outDir);
    await T("export-submit").click();
    const phase = await finish();
    await T("export-run-done").click();
    await dialog.waitFor({ state: "hidden" });
    return phase;
  };
  const reopen = async () => {
    await win.locator("[data-testid=export]").click();
    await dialog.waitFor({ state: "visible" });
    await win.waitForTimeout(500);
  };
  const alphaTool = () => {
    const bin = path.join(outDir, "alpha-tool");
    if (!fs.existsSync(bin) && spawnSync("swiftc", ["-O", path.join(here, "../fixtures/alpha.swift"), "-o", bin], { stdio: "ignore" }).status !== 0) return null;
    return bin;
  };
  const decode = (file) => {
    const bin = alphaTool();
    return bin ? spawnSync(bin, [file]).stdout.toString().trim() : null;
  };
  for (const n of ["ex-pr422.mov", "ex-prhq.mov", "ex-prlt.mov", "ex-pr4444.mov", "ex-hevca.mov", "ex-hevc.mp4"]) fs.rmSync(path.join(outDir, n), { force: true });

  await reopen();
  await choose("export-resolution", "480P");
  const codecs = await (async () => {
    await T("export-codec").click();
    await win.waitForTimeout(300);
    const labels = (await win.locator("[data-testid=export-codec-option]").allInnerTexts()).map((t) => t.split("\n")[0].trim());
    await shot("c1-codec-menu");
    await win.keyboard.press("Escape");
    return labels;
  })();
  const want = ["H.264", "HEVC", "HEVC with alpha", "ProRes 422 LT", "ProRes 422", "ProRes 422 HQ", "ProRes 4444"];
  check(`the Codec menu lists ${want.join(", ")}`, want.every((w) => codecs.includes(w)), codecs.join(" | "));

  const h264 = await estimate();
  await choose("export-codec", "ProRes 422 HQ");
  const hq = await estimate();
  check("ProRes 422 HQ: the footer's size grows far past H.264's", hq > h264 * 5, `${h264} → ${hq} bytes`);
  check("its Format is mov and the menu is greyed", /mov/.test(await T("export-format").innerText()) && (await T("export-format").isDisabled()));
  check("its Bit rate menu is greyed", await T("export-bitrate").isDisabled());
  check("its note says it is an editing format", /editing format/.test(await T("export-codec-note").innerText()));
  await shot("c2-prores");
  await choose("export-codec", "HEVC with alpha");
  check("HEVC with alpha: Format mov, greyed; Bit rate still on", /mov/.test(await T("export-format").innerText()) && (await T("export-format").isDisabled()) && !(await T("export-bitrate").isDisabled()));
  await shot("c3-hevc-alpha");

  const stream = (file) => probe(file).streams.find((s) => s.codec_type === "video");
  const cases = [
    ["ProRes 422", "ex-pr422", "Standard"],
    ["ProRes 422 HQ", "ex-prhq", "HQ"],
    ["ProRes 422 LT", "ex-prlt", "LT"],
    ["ProRes 4444", "ex-pr4444", "4444"],
  ];
  for (const [label, name, profile] of cases) {
    const phase = await exportAs(label, name);
    const f = path.join(outDir, `${name}.mov`);
    const s = fs.existsSync(f) ? stream(f) : null;
    check(`${label} exports a .mov read back as ProRes ${profile}`, phase === "done" && s?.codec_name === "prores" && s.profile === profile && probe(f).format.format_name.includes("mov"), `${phase} ${s?.codec_name} ${s?.profile} ${s?.pix_fmt}`);
    await reopen();
  }
  const phase = await exportAs("HEVC with alpha", "ex-hevca");
  const fa = path.join(outDir, "ex-hevca.mov");
  const sa = fs.existsSync(fa) ? stream(fa) : null;
  check("HEVC with alpha exports a .mov tagged hvc1", phase === "done" && sa?.codec_name === "hevc" && sa.codec_tag_string === "hvc1", `${phase} ${sa?.codec_name} ${sa?.codec_tag_string}`);
  const d = decode(fa);
  check("AVFoundation decodes it (with an alpha channel read)", d === null || /^frames \d+ alpha/.test(d) && !/^frames 0 /.test(d), String(d));
  await reopen();
  await choose("export-codec", "HEVC");
  check("back on HEVC the Format menu is free again", !(await T("export-format").isDisabled()) && !(await T("export-bitrate").isDisabled()));
  await choose("export-format", "mp4");
  await T("export-name").fill("ex-hevc");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  const p2 = await finish();
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });
  const fh = path.join(outDir, "ex-hevc.mp4");
  const sh = fs.existsSync(fh) ? stream(fh) : null;
  check("a plain HEVC mp4 is still HEVC, tagged hvc1", p2 === "done" && sh?.codec_name === "hevc" && sh.codec_tag_string === "hvc1", `${p2} ${sh?.codec_name} ${sh?.codec_tag_string}`);
  const dh = decode(fh);
  check("and decodes in AVFoundation", dh === null || !/^frames 0 /.test(dh), String(dh));
  return report();
};
