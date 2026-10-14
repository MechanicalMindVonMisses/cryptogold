import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/lib/**/*.test.ts",
            "src/server/**/*.test.ts",
            "src/app/**/*.test.ts",
            "src/state/**/*.test.ts",
            "src/components/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx", "src/hooks/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/server/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__fixtures__/**"],
      reporter: ["text-summary", "text"],
    },
  },
});
