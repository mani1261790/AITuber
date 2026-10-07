import { defineConfig, loadEnv } from "vite";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { allowedMotionFiles } from "./src/motion-catalog.ts";
import react from "@vitejs/plugin-react";
import { resolveLanHost } from "../../scripts/lan-host.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL("../../", import.meta.url).pathname, "AITUBER_LAN_");
  return {
    plugins: [react(), {
      name: "local-motion-assets", apply: "serve",
      configureServer(server) {
        server.middlewares.use("/__motion-assets", (req, res) => {
          const name = (req.url ?? "").split("?")[0]?.slice(1);
          if (!allowedMotionFiles().includes(name ?? "")) { res.statusCode = 404; res.end("Unknown motion asset"); return; }
          const path = new URL(`../../.data/motion-assets/${name}`, import.meta.url);
          void stat(path).then(info => {
            res.setHeader("Content-Type", name?.endsWith(".fbx") ? "application/octet-stream" : "model/gltf-binary");
            res.setHeader("Content-Length", info.size);
            const stream = createReadStream(path);
            stream.on("error", () => res.destroy()); stream.pipe(res);
            res.on("close", () => stream.destroy());
          }).catch(() => { res.statusCode = 404; res.end("Motion asset not installed"); });
        });
      },
    }],
    server: {
      host: resolveLanHost(env.AITUBER_LAN_HOST),
      proxy: { "/api": { target: "http://127.0.0.1:4310", ws: true, headers: { "x-aituber-surface": "classroom" } } },
    },
  };
});
