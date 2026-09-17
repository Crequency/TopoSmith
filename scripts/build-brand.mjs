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

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from './playwright.mjs';

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
/*
 * iOS 会自己给主屏图标套圆角遮罩，所以那一张要用**全出血**版本：
 * 把六边形徽章换成铺满画布的方块（顺带去掉内侧亮边，否则方角上会露出一圈描边）。
 * 形状变了要让这里失败得响亮，别悄悄生成一张四角透明的图标。
 */
const bleedSvg = markSvg
  .replace(/<polygon id="ts-badge-shape"[^>]*\/>/, '<rect width="64" height="64" fill="url(#ts-badge)"/>')
  .replace(/<polygon points="32,3.4[^>]*\/>/, '');
if (bleedSvg === markSvg || bleedSvg.includes('ts-badge-shape')) {
  throw new Error('全出血变体替换失败：mark.svg 的徽章形状写法变了（需要 id="ts-badge-shape" 的多边形）');
}

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
