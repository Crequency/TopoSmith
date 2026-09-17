import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// 直接 import JSON（tsconfig 已开 resolveJsonModule）：不碰 node 内置模块，
// 也就不用为了一个版本号把 @types/node 引进只有 DOM 类型的应用包
import rootPackage from '../../package.json';

/**
 * 端口由项目自身决定（DevHub 只登记、不分配端口）。
 * 31006 已避开：13080/13081（DSH 保留）、18080（litepad + Caddy）、
 * 18090（fellowearth）、50011（watermark-studio）、42301（fake-reports-generator）。
 */
/**
 * 部署基路径。
 *
 * GitHub Pages 的**项目站点**是子路径（`https://<owner>.github.io/<repo>/`），
 * 资源与 favicon 都必须带上这个前缀，否则整站白屏 + 图标 404。
 * 因此 base 由 `BASE_PATH` 环境变量注入（CI 里取自 actions/configure-pages 的 base_path，
 * 用户站点会自动得到 `/`），本地开发与常规构建保持默认的 `/`。
 * 相关引用：index.html 用 `%BASE_URL%`，组件里用 `import.meta.env.BASE_URL`。
 */
/**
 * 读构建期环境变量。
 *
 * 不用 `process.env` 直接读：本包的 tsconfig 只有 DOM 类型（应用是纯浏览器代码），
 * 为了一个环境变量把 `@types/node` 引进来的代价更大 —— 那会让应用代码也能"合法"地用
 * node 全局变量。这里只声明用到的那一小块形状。
 */
function buildEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

const base = buildEnv('BASE_PATH') ?? '/';

/** 版本号取**仓库根**的 package.json，界面上的"关于"就不用另写一份 */
const version = rootPackage.version;

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
  /*
   * 本地预览也要带同一条 base，便于在部署前用真实子路径验证：
   *   BASE_PATH=/TopoSmith/ pnpm build && BASE_PATH=/TopoSmith/ pnpm preview
   */
  preview: {
    host: '0.0.0.0',
    port: 31007,
    strictPort: true,
  },
});
