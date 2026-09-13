import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveLanHost } from "../../scripts/lan-host.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL("../../", import.meta.url).pathname, "AITUBER_LAN_");
  return {
    plugins: [react()],
    server: {
      host: resolveLanHost(env.AITUBER_LAN_HOST),
      proxy: { "/api": { target: "http://127.0.0.1:4310", ws: true, headers: { "x-aituber-surface": "classroom" } } },
    },
  };
});
