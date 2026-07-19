import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // milod 守护进程：REST 与 WS 都代理过去，前端只认同源
    proxy: {
      "/api": "http://127.0.0.1:8899",
      "/ws": { target: "ws://127.0.0.1:8899", ws: true },
    },
  },
});
