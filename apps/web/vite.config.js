import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API server runs on :4000 (npm run dev:server). Proxying keeps the app same-origin, exactly
// like production (the server serves the built app), so session cookies and origin checks behave identically.
const API_TARGET = process.env.CLASSICADE_API ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/socket.io": { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
