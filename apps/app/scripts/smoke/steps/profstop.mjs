// Stop the profile started by profstart; print self time and inclusive time per function.
import fsMod from "node:fs";
export default async ({ outDir }) => {
  const { profile } = await globalThis.__cdp.send("Profiler.stop");
  fsMod.writeFileSync(`${outDir}/profile.cpuprofile`, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = (n) => `${n.callFrame.functionName || "(anon)"} ${(n.callFrame.url || "").split("/").pop()}:${n.callFrame.lineNumber}`;
  const selfBy = new Map(), inclBy = new Map();
  for (const [id, t] of self) {
    const n = nodes.get(id);
    selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + t);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const k = key(nodes.get(cur));
      if (seen.has(k)) continue;
      seen.add(k);
      inclBy.set(k, (inclBy.get(k) ?? 0) + t);
    }
  }
  const top = (m, n, f = () => true) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(6)} ms  ${k}`).join("\n");
  return `\n-- self --\n${top(selfBy, 20)}\n-- inclusive (named) --\n${top(inclBy, 30, (k) => !k.startsWith("(") && !/^(anon)/.test(k))}`;
};
