import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
