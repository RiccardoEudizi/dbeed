import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solidStart({ devOverlay: false }), tailwindcss(), nitro()],
  resolve: {
    alias: {
      // resolve-uri's "browser" export points at a UMD build with no ESM
      // default export, which Vite dev serves raw. Pin the ESM build.
      "@jridgewell/resolve-uri": fileURLToPath(
        new URL("./node_modules/@jridgewell/resolve-uri/dist/resolve-uri.mjs", import.meta.url)
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  },
});

