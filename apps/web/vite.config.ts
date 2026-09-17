import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 端口由项目自身决定（DevHub 只登记、不分配端口）。
 * 31006 已避开：13080/13081（DSH 保留）、18080（litepad + Caddy）、
 * 18090（fellowearth）、50011（watermark-studio）、42301（fake-reports-generator）。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 31006,
    strictPort: true,
    // 信任域名：拓扑匠的开发入口（其余域名/裸 IP 一律拒绝）
    allowedHosts: ['toposmith.dev-u26-001.services.local', 'localhost', '127.0.0.1'],
  },
  build: {
    target: 'es2022',
  },
});
