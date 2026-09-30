import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PORT = Number(process.env.LOOM_API_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.LOOM_UI_PORT ?? 5173),
    proxy: { "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true } },
  },
  build: { outDir: "dist/client", emptyOutDir: true },
});
