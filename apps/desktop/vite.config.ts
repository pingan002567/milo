import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
  plugins: [react()],
  // 显式挂 PostCSS：postcss.config.js 自动探测在本项目里没生效（@tailwind 未展开）
  css: { postcss: { plugins: [tailwindcss(), autoprefixer()] } },
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
