import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// The @fontsource faces list a WOFF2 file with a WOFF fallback. Chromium, and the engine (handed
// the same files, lib/fonts.ts), only ever load the WOFF2, so the fallbacks aren't built in.
const woff2Only = (): Plugin => ({
  name: "openrip:woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]@fontsource[\\/].*\.css$/.test(id)) return;
    return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, "");
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [woff2Only(), react(), tailwindcss(), tsconfigPaths()],
  // When packaged, the renderer is loaded via `BrowserWindow.loadFile(...)` (file://...).
  // Vite's default `base: "/"` would emit `/assets/...` URLs which break under file://.
  // Use a relative base for production builds so CSS/JS load correctly from dist/.
  base: mode === "development" ? "/" : "./",
  resolve: {
    alias: {
      "@app/export-renderer": path.resolve(
        __dirname,
        "../export-renderer/src/index.ts",
      ),
    },
  },
  server: {
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, "../export-renderer"),
        path.resolve(__dirname, "..", ".."),
      ],
    },
  },
}));