import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { protocol, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import fsp from "node:fs/promises";
import mime from "mime-types";

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;

  const startStr = m[1];
  const endStr = m[2];

  // bytes=-500 (last 500 bytes)
  if (startStr === "" && endStr !== "") {
    const suffixLen = Number(endStr);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, size - suffixLen);
    const end = size - 1;
    return { start, end };
  }

  const start = Number(startStr);
  let end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;

  end = Math.min(end, size - 1);
  return { start, end };
}

function nodeStreamToWebStream(
  nodeStream: fs.ReadStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        try {
          const uint8Array =
            typeof chunk === "string"
              ? new TextEncoder().encode(chunk)
              : new Uint8Array(chunk);
          controller.enqueue(uint8Array);
        } catch (err) {
          // Stream might be closed, ignore
        }
      });

      nodeStream.on("end", () => {
        try {
          controller.close();
        } catch (err) {
          // Already closed, ignore
        }
      });

      nodeStream.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // Already errored, ignore
        }
        nodeStream.destroy();
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

// Register 'app://' as a privileged scheme as early as possible (before 'ready')
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true, // important for window.fetch
      corsEnabled: true,
    },
  },
]);


// For cover paths we need to convert the path to a local file path
const isCoverPath = (filePath: string) => {
  return filePath.startsWith("/projects-json/covers/");
};

const getCoverPath = (filePath: string, userDataDir: string) => {
  return path.join(userDataDir, filePath.slice(1));
};

class AppDirProtocol implements AppModule {
  private electronApp: Electron.App | null = null;
  private rendererDistPath: string | null = null;

  private stripLeadingSlashes(p: string): string {
    return (p || "").replace(/^\/+/, "");
  }

  /**
   * Resolve `relOrAbs` under `basePath` and reject traversal.
   * Returns an absolute path under `basePath`, or null if it escapes.
   */
  private resolveUnderBase(basePath: string, relOrAbs: string): string | null {
    const baseAbs = path.resolve(basePath);
    const abs = path.resolve(baseAbs, relOrAbs);
    const rel = path.relative(baseAbs, abs);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return abs;
    }
    return null;
  }

  private tryResolveRendererDistPath(app: Electron.App): string | null {
    const candidates: string[] = [];
    try {
      const require = createRequire(import.meta.url);
      const indexHtml = require.resolve("@app/renderer/dist/index.html");
      candidates.push(path.dirname(indexHtml));
    } catch {
      // ignore
    }
    try {
      const appPath = app.getAppPath();
      candidates.push(path.join(appPath, "node_modules", "@app", "renderer", "dist"));
      candidates.push(
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "node_modules",
          "@app",
          "renderer",
          "dist",
        ),
      );
      candidates.push(
        path.join(
          process.resourcesPath,
          "app",
          "node_modules",
          "@app",
          "renderer",
          "dist",
        ),
      );
      candidates.push(path.join(process.resourcesPath, "node_modules", "@app", "renderer", "dist"));
    } catch {
      // ignore
    }

    for (const cand of candidates) {
      try {
        const idx = path.join(cand, "index.html");
        if (fs.existsSync(idx)) {
          return cand;
        }
      } catch {
        // ignore
      }
    }

    console.warn(
      "[AppDirProtocol] Could not resolve renderer dist path; app://renderer/* will 404. Candidates:",
      candidates,
    );
    return null;
  }

  private async returnResponseFromRenderer(request: Request): Promise<Response> {
    const u = new URL(request.url);
    const base = this.rendererDistPath;
    if (!base) {
      return new Response(null, { status: 404 });
    }

    let rel = this.stripLeadingSlashes(decodeURIComponent(u.pathname || ""));
    if (rel === "" || rel === "/") rel = "index.html";
    rel = path.posix.normalize(rel).replace(/\\/g, "/");
    rel = this.stripLeadingSlashes(rel);

    // If a directory is requested, serve its index.html.
    if (rel.endsWith("/")) rel = `${rel}index.html`;

    let filePath = this.resolveUnderBase(base, rel);
    if (!filePath) {
      return new Response(null, { status: 404 });
    }

    // SPA fallback: for routes without an extension, fall back to index.html.
    const hasExt = Boolean(path.extname(rel));
    try {
      const st = await fsp.stat(filePath);
      if (st.isDirectory()) {
        const idx = this.resolveUnderBase(base, path.join(rel, "index.html"));
        if (!idx) return new Response(null, { status: 404 });
        filePath = idx;
      }
    } catch {
      if (!hasExt) {
        const idx = this.resolveUnderBase(base, "index.html");
        if (!idx) return new Response(null, { status: 404 });
        filePath = idx;
      } else {
        return new Response(null, { status: 404 });
      }
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) return new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 404 });
    }

    const ct = mime.lookup(filePath) || "application/octet-stream";
    const headers = new Headers({
      "Content-Type": String(ct),
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(nodeStreamToWebStream(fs.createReadStream(filePath)), { status: 200, headers });
  }

  private corsHeadersFor(request: Request): Record<string, string> {
    // Mirror the Origin if present so the renderer can fetch app:// resources in both dev (http://localhost)
    // and prod (app://renderer) contexts.
    const origin = request.headers.get("origin") || "*";
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
  }

  private withCors(request: Request, response: Response): Response {
    const headers = new Headers(response.headers);
    const cors = this.corsHeadersFor(request);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private async returnResponseFromLocalFile(request: Request): Promise<Response> {

      const urlObj = new URL(request.url);
      const userDataDir = this.electronApp?.getPath("userData") ?? "";
      let filePath = decodeURIComponent(urlObj.pathname);
      filePath = path.posix.normalize(filePath).replace(/\\/g, "/");
      // On Windows, `file://C:/...` (and similar custom protocols) often arrive as `/C:/...`.
      // If this is a drive-letter path, strip any leading slashes so Node fs APIs resolve it correctly.
      const withoutLeadingSlashes = filePath.replace(/^\/+/, "");
      if (/^[a-zA-Z]:\//.test(withoutLeadingSlashes)) {
        filePath = withoutLeadingSlashes;
      }
      if (isCoverPath(filePath)) {
        filePath = getCoverPath(filePath, userDataDir);
      }

      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return new Response(null, { status: 404 });
      const size = stat.size;

      const ct = mime.lookup(filePath) || "application/octet-stream";
      const range = parseRange(request.headers.get("range"), size);

      if (!range) {
        const headers = new Headers({
          "Content-Type": String(ct),
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        // HEAD must not include a body; serving a body here can lead to mid-stream
        // cancellations that trigger undici stream state errors.
        if (request.method === "HEAD") {
          return new Response(null, { status: 200, headers });
        }
        return new Response(nodeStreamToWebStream(fs.createReadStream(filePath)), { status: 200, headers });
      }
    
      const { start, end } = range;
      const chunkSize = end - start + 1;
    
      const headers = new Headers({
        "Content-Type": String(ct),
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      });

      if (request.method === "HEAD") {
        return new Response(null, { status: 206, headers });
      }
      return new Response(nodeStreamToWebStream(fs.createReadStream(filePath, { start, end })), { status: 206, headers });
   
  }

  async enable({ app }: ModuleContext): Promise<void> {
    await app.whenReady();
    this.electronApp = app;
    // Resolve renderer dist once so `app://renderer/*` works in packaged builds.
    this.rendererDistPath = this.tryResolveRendererDistPath(app);

    ipcMain.handle("appdir:resolve-path", async (event, filePath: string) => {
      let url = new URL(filePath);
      let pathName = url.pathname;
      filePath = decodeURIComponent(pathName);
      filePath = path.posix.normalize(filePath).replace(/\\/g, "/");

      // Resolve packaged renderer assets to a real local file path.
      if (url.hostname === "renderer") {
        const base = this.rendererDistPath;
        if (!base) return null;
        let rel = this.stripLeadingSlashes(filePath);
        if (rel === "" || rel === "/") rel = "index.html";
        rel = path.posix.normalize(rel).replace(/\\/g, "/");
        rel = this.stripLeadingSlashes(rel);
        const resolved = this.resolveUnderBase(base, rel);
        if (!resolved) return null;
        try {
          const st = await fsp.stat(resolved);
          if (st.isFile()) return resolved;
        } catch {
          // ignore
        }
        return null;
      }

      const userDataDir = this.electronApp?.getPath("userData") ?? "";
      if (isCoverPath(filePath)) {
        filePath = getCoverPath(filePath, userDataDir);
      }
      return filePath;
    });

    protocol.handle("app", async (request) => {
       // CORS/preflight handling for renderer -> app:// fetches

       if (request.method === "OPTIONS") {
         return new Response(null, { status: 204, headers: this.corsHeadersFor(request) });
       }
       if (request.method !== "GET" && request.method !== "HEAD") {
         const headers = this.corsHeadersFor(request);
         headers["Allow"] = "GET, HEAD, OPTIONS";
         return new Response(null, { status: 405, headers });
       }
       try {
        const u = new URL(request.url);
        if (u.hostname === "renderer") {
          const r = await this.returnResponseFromRenderer(request);
          return this.withCors(request, r);
        }
       } catch {
        // ignore URL parse errors; fall back below
       }
       try {
        const r = await this.returnResponseFromLocalFile(request);
        return this.withCors(request, r);
       } catch (e) {
        return new Response(null, { status: 404, headers: this.corsHeadersFor(request) });
       }
    });
  }
}

export function appDirProtocol(): AppDirProtocol {
  return new AppDirProtocol();
}
