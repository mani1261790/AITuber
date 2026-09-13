import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveLanHost } from "../../scripts/lan-host.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL("../../", import.meta.url).pathname, "AITUBER_LAN_");
  return {
    plugins: [react()],
    define: { __AITUBER_CLASSROOM_HOST__: JSON.stringify(resolveLanHost(env.AITUBER_LAN_HOST)) },
    server: {
      host: "127.0.0.1",
      proxy: { "/api": { target: "http://127.0.0.1:4310", ws: true, headers: { "x-aituber-surface": "operator" } } },
    },
  };
});
