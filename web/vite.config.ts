import { defineConfig } from "vitest/config";
import { extname } from "node:path";
import react from "@vitejs/plugin-react";
import type { ViteDevServer } from "vite";

function serveDocs({ middlewares }: Pick<ViteDevServer, "middlewares">) {
  middlewares.use((request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if ((url.pathname === "/docs" || url.pathname.startsWith("/docs/")) && !extname(url.pathname)) {
      if (!url.pathname.endsWith("/")) {
        response.writeHead(302, { Location: url.pathname + "/" + url.search }).end();
        return;
      }
      request.url = url.pathname + "index.html" + url.search;
    }
    next();
  });
}

export default defineConfig({
  plugins: [react(), {
    name: "local-docs",
    configureServer: serveDocs,
    configurePreviewServer: serveDocs,
  }],
  base: "/",
  build: {
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
