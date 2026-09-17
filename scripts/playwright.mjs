/**
 * 取 Playwright 的 Chromium（`build-brand` 与 `screenshot` 共用）。
 *
 * 优先按标准方式解析（装了 playwright 就能用）；本机开发容器里 playwright 装在兄弟仓库，
 * 所以保留一条**兜底路径**，可用 `PLAYWRIGHT_PATH` 覆盖。写死路径会随机器变化失效，
 * 这里把它降级成最后的选择。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadChromium() {
  const candidates = [
    process.env['PLAYWRIGHT_PATH'],
    'playwright',
    '/home/dynesshely/dsh-workspaces/tools/watermark-studio/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate).chromium;
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error(
    '找不到 playwright。请先安装（pnpm add -D playwright），或用 PLAYWRIGHT_PATH 指向已有的安装。',
  );
}

/**
 * 容器/服务器上可能没有中文字体，截图会把中文画成方框。
 * 这里给出提示（并允许用 FONTCONFIG_FILE 指到一份带中文字体的 fontconfig）。
 */
export function cjkFontHint() {
  if (process.env['FONTCONFIG_FILE']) return null;
  return (
    '提示：未设置 FONTCONFIG_FILE。若本机没有中文字体，截图里的中文会渲染成方框 —— ' +
    '可准备一份只加一个字体目录的 fonts.conf 并设置 FONTCONFIG_FILE 指向它。'
  );
}
