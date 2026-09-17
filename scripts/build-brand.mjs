/**
 * 品牌产物的生成脚本（assets/brand → apps/web/public）
 *
 * 为什么要有脚本而不是"手工导出几张贴图"：
 *  1. favicon 有 5 个尺寸/格式（SVG + 16/32/180/512 PNG），手工维护必然漂移；
 *  2. 唯一的事实来源是 `assets/brand/mark.svg`，派生文件全部由它渲染，
 *     改一次 mark 跑一次 `pnpm brand` 就够了。
 *
 * 渲染用 Playwright 的 Chromium（与本仓其它验证脚本同一套来源）：
 * SVG → PNG 只需"打开 → 元素截图"，不必引入 sharp/resvg 这类原生依赖。
 */

import { createRequire } from 'node:module';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * 取 Playwright 的 Chromium。
 *
 * 优先按标准方式解析（装了 playwright 就能用）；本机开发容器里 playwright 装在
 * 兄弟仓库，所以保留一条**兜底路径**，可用 `PLAYWRIGHT_PATH` 覆盖。
 * 写死路径会随机器变化而失效，这里把它降级成最后的选择。
 */
function loadChromium() {
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

const chromium = loadChromium();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/brand');
const OUT = join(ROOT, 'apps/web/public');

/**
 * 直接拷贝的产物：[源文件, 目标文件]
 *
 * 只产出**应用真正引用到的**文件（index.html 与 manifest.webmanifest）；
 * 字标不从 assets/brand 复制过来 —— 没人引用的资源就是会过期的资源。
 */
const COPIES = [['mark.svg', 'favicon.svg']];

/** 需要渲染的 PNG 尺寸 */
const RASTER = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  // iOS 自己会加圆角遮罩：这里用**全出血**版本，避免圆角外露出透明像素
  { name: 'apple-touch-icon.png', size: 180, bleed: true },
];

mkdirSync(OUT, { recursive: true });

for (const [from, to] of COPIES) {
  copyFileSync(join(SRC, from), join(OUT, to));
  // copyFileSync 连权限一起复制；源文件若是 600，产物在 HTTP 服务下可能读不到
  chmodSync(join(OUT, to), 0o644);
  console.log(`拷贝 ${from} → apps/web/public/${to}`);
}

const markSvg = readFileSync(join(SRC, 'mark.svg'), 'utf8');
const bleedSvg = markSvg.replace('rx="14"', 'rx="0"').replace('rx="13"', 'rx="0"');
if (bleedSvg === markSvg) throw new Error('全出血变体替换失败：mark.svg 的圆角写法变了？');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

for (const { name, size, bleed } of RASTER) {
  const svg = bleed ? bleedSvg : markSvg;
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}#m{width:${size}px;height:${size}px;display:block}</style>
<div id="m">${svg.replace(/width="64" height="64"/, `width="${size}" height="${size}"`)}</div>`;
  await page.setContent(html);
  const buffer = await page.locator('#m').screenshot({ omitBackground: true });
  writeFileSync(join(OUT, name), buffer);
  console.log(`渲染 apps/web/public/${name} (${size}×${size}${bleed ? ' 全出血' : ''})`);
}

await browser.close();
