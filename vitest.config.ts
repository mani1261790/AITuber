import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@aituber/contracts": new URL("./packages/contracts/src/index.ts", import.meta.url).pathname,
      "@aituber/content": new URL("./packages/content/src/index.ts", import.meta.url).pathname,
      "@aituber/lesson": new URL("./packages/lesson/src/index.ts", import.meta.url).pathname,
      "@aituber/presentation": new URL("./packages/presentation/src/index.ts", import.meta.url).pathname,
      "@aituber/providers": new URL("./packages/providers/src/index.ts", import.meta.url).pathname,
      "@aituber/storage": new URL("./packages/storage/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["apps/**/*.{test,spec}.{ts,tsx}", "packages/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
