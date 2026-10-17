// Start a CPU profile of the renderer (stop it with profstop). For function names, build the
// renderer unminified first: `npx vite build --minify false` in packages/renderer.
export default async ({ win }) => {
  const cdp = await win.context().newCDPSession(win);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  globalThis.__cdp = cdp;
};
