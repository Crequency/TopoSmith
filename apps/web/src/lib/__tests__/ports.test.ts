/** 端口图元布局单测（FR-32） */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { NODE_H, NODE_W, cardWidthOf } from '../geometry';
import { panelBand, hitPortGlyph, portGlyphOf, portLayout } from '../ports';

const device = (key: string, x = 100, y = 200) =>
  instantiate(key, `dev-${key}`, key, x, y);

describe('端口条带布局', () => {
  it('端口少的设备：单行、显示端口名、图元够大', () => {
    const sw = device('switch-5-2.5g'); // 7 个端口
    const glyphs = portLayout(sw);
    expect(glyphs).toHaveLength(7);
    expect(new Set(glyphs.map((g) => g.row)).size).toBe(1);
    expect(glyphs[0]!.showLabel).toBe(true);
    expect(glyphs[0]!.w).toBeGreaterThanOrEqual(11.5);
  });

  it('27 口交换机：自动换行且全部落在卡片内', () => {
    const big = device('switch-24-1g'); // 24 电口 + 2 光口（正面）+ 1 管理口（背面）
    const glyphs = portLayout(big);
    expect(glyphs).toHaveLength(27);
    expect(new Set(glyphs.map((g) => g.row)).size).toBe(2);
    for (const glyph of glyphs) {
      expect(glyph.x).toBeGreaterThanOrEqual(big.x);
      expect(glyph.x + glyph.w).toBeLessThanOrEqual(big.x + NODE_W);
      const band = panelBand(big);
      expect(glyph.y).toBeGreaterThanOrEqual(band.top - 1);
      expect(glyph.y + glyph.h).toBeLessThanOrEqual(band.top + band.height + 1);
    }
  });

  it('同一行内图元互不重叠', () => {
    for (const key of ['switch-5-2.5g', 'switch-24-1g', 'router', 'server-rack']) {
      const layout = portLayout(device(key));
      const rows = new Map<number, { x: number; w: number }[]>();
      for (const glyph of layout) {
        const list = rows.get(glyph.row) ?? [];
        list.push({ x: glyph.x, w: glyph.w });
        rows.set(glyph.row, list);
      }
      for (const list of rows.values()) {
        list.sort((a, b) => a.x - b.x);
        for (let i = 1; i < list.length; i += 1) {
          expect(list[i]!.x).toBeGreaterThanOrEqual(list[i - 1]!.x + list[i - 1]!.w - 0.01);
        }
      }
    }
  });

  it('连线接入点统一落在卡片底边', () => {
    const router = device('router');
    for (const glyph of portLayout(router)) {
      expect(glyph.anchorY).toBe(router.y + NODE_H);
    }
  });

  it('命中测试按图元矩形判定，并带少量容差', () => {
    const sw = device('switch-8-1g');
    const glyphs = portLayout(sw);
    const target = glyphs[3]!;
    expect(hitPortGlyph(sw, target.centerX, target.centerY)).toBe(target.port);
    // 容差内仍命中
    expect(hitPortGlyph(sw, target.x - 1, target.y - 1)).toBe(target.port);
    // 远离所有端口则不命中
    expect(hitPortGlyph(sw, sw.x + 5, sw.y + 5)).toBeUndefined();
  });

  it('portGlyphOf 能按端口 id 取回同一个图元', () => {
    const router = device('router');
    const first = portLayout(router)[0]!;
    expect(portGlyphOf(router, first.port.id)?.centerX).toBe(first.centerX);
  });

  it('端口带正/反面归属：按面过滤只保留该面的端口（FR-36）', () => {
    const sw = device('switch-24-1g');
    const front = sw.ports.filter((p) => (p.side ?? 'front') === 'front');
    const rear = sw.ports.filter((p) => (p.side ?? 'front') === 'rear');
    expect(front).toHaveLength(26);
    expect(rear.map((p) => p.name)).toEqual(['MGMT1']);
    // 图元布局对两面都给出位置（保证翻转时端口不跳动）
    expect(portGlyphOf(sw, 'port-mgmt1')).toBeDefined();
  });

  it('多 U 设备：卡片更高，端口画在面板区内，接入点在卡片底边（FR-39 / FR-40）', () => {
    const olt = device('olt'); // 默认 8U
    olt.rackUnits = 8;
    const band = panelBand(olt);
    const glyphs = portLayout(olt);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(band.cardHeight).toBeGreaterThan(NODE_H);

    for (const glyph of glyphs) {
      // 端口落在面板区内
      expect(glyph.y).toBeGreaterThanOrEqual(band.top - 1);
      expect(glyph.y + glyph.h).toBeLessThanOrEqual(band.top + band.height + 1);
      // 电缆接入点仍在卡片底边
      expect(glyph.anchorY).toBe(olt.y + band.cardHeight);
    }
  });

  it('4U 卡片的面板区能放下一行带名称的端口（默认 4U = 标准卡片高度）', () => {
    const sw = device('switch-8-1g');
    expect(sw.rackUnits).toBe(4);
    const band = panelBand(sw);
    const glyphs = portLayout(sw);
    expect(new Set(glyphs.map((g) => g.row)).size).toBe(1);
    expect(glyphs[0]!.showLabel).toBe(true);
    expect(band.cardHeight).toBe(NODE_H);
  });

  it('上架后卡片变宽（19 英寸设备宽度），同样端口数占用更少的行（FR-41）', () => {
    const big = device('switch-24-1g'); // 27 口
    const unmountedRows = new Set(portLayout(big).map((g) => g.row)).size;
    big.mount = { rackId: 'r', startU: 1 };
    const mounted = portLayout(big);
    const mountedRows = new Set(mounted.map((g) => g.row)).size;

    expect(mountedRows).toBeLessThanOrEqual(unmountedRows);
    // 图元必须全部落在更宽的卡片内
    for (const glyph of mounted) {
      expect(glyph.x).toBeGreaterThanOrEqual(big.x);
      expect(glyph.x + glyph.w).toBeLessThanOrEqual(big.x + cardWidthOf(big));
    }
  });

  it('没有端口的设备返回空数组（不抛异常）', () => {
    const custom = device('switch-8-1g');
    custom.ports = [];
    expect(portLayout(custom)).toEqual([]);
  });
});
