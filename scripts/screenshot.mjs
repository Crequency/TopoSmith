/**
 * 生成 README 用的界面截图（默认取 docs/assets/screenshot-office.png）。
 *
 * 之所以做成脚本而不是手工截一张贴进仓库：界面一改，图就会和产品不一致 ——
 * 这张图是 README 的"第一印象"，不允许过期。脚本会：
 *   1. 载入指定的预置场景；
 *   2. 跑一次连通性诊断（让画布出现路径高亮与流向动画，右侧诊断面板有结论）；
 *   3. 选中一台设备（检查器有内容），关掉提示条；
 *   4. 按指定尺寸截图（默认 1920×1080，与 README 的展示宽度匹配）。
 *
 * 用法：
 *   pnpm screenshot                       # 办公网场景 → docs/assets/screenshot-office.png
 *   pnpm screenshot -- --preset idc --out docs/assets/idc.png --width 1600 --height 900
 *   SMOKE_URL=http://127.0.0.1:31006/ pnpm screenshot
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cjkFontHint, loadChromium } from './playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const preset = arg('preset', 'office');
const out = resolve(ROOT, arg('out', 'docs/assets/screenshot-office.png'));
const width = Number(arg('width', '1920'));
const height = Number(arg('height', '1080'));
const url = process.env['SMOKE_URL'] ?? 'http://127.0.0.1:31006/';

const hint = cjkFontHint();
if (hint) console.warn(hint);

const chromium = loadChromium();
const browser = await chromium.launch({ env: { ...process.env } });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__toposmith), null, { timeout: 20000 });
await page.waitForTimeout(600);

await page.evaluate((key) => window.__toposmith.getState().loadPreset(key), preset);
await page.waitForTimeout(900);
await page.evaluate(() => {
  const api = window.__toposmith;
  api.getState().dismissToast();
  // 诊断一对"能通"的设备：画布上有流线，右侧有结论与逐跳
  api.getState().setDiagSrc('dev-pc2');
  api.getState().setDiagDst('192.168.30.10');
  api.getState().runDiag('ping');
  api.getState().selectOneDevice('dev-pc1');
});
await page.waitForTimeout(1600);
await page.evaluate(() => window.__toposmith.getState().dismissToast());
await page.waitForTimeout(200);

mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const s = window.__toposmith.getState();
  return {
    scenario: s.scenario.name,
    devices: s.scenario.devices.length,
    cables: s.scenario.cables.length,
    diagOk: s.diag.result?.ok ?? null,
    zoom: +s.viewport.k.toFixed(3),
  };
});
console.log(`已输出 ${out.replace(`${ROOT}/`, '')}（${width}×${height}）`);
console.log(JSON.stringify(info, null, 2));
await browser.close();
