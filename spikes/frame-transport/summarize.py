"""Format RESULT JSON lines from main.cjs into one-line summaries."""
import json
import sys

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    d = json.loads(line)
    if d.get("hung"):
        print("HUNG", d)
        continue
    r = d.get("renderer") or {}
    lat = (r.get("recvLatencyMs") or {}).get("p95")
    cost = d["mainSendMs"]["p95"]
    if cost is None:
        cost = d["overlayPresentMs"]["p95"]
    print("{:<14}{:<15}{:<7}{:<9} fps={:<5} drops={:<3} main_p95={}ms recv_p95={}ms drawn={} cpu={}".format(
        d["mode"], d["stream"], d["fmt"], d["draw"], d["sentFps"], d["underruns"], cost, lat,
        r.get("drawnFps"), d["cpuPercent"]))
