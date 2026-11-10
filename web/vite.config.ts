import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` + HashRouter = the build works from any path on any static host, no rewrites needed.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { global: "globalThis" },
  build: { target: ["es2020", "safari14", "chrome87", "firefox78"], chunkSizeWarningLimit: 2000 },
});
