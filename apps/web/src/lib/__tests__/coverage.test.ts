/**
 * 覆盖交互几何单测
 *
 * 这些数字决定"能不能抓住圈边、拖出来的半径对不对"。手感 bug 用肉眼看最难发现
 * （差几个像素、差 5%半径都"看着差不多"），因此全部钉成断言。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import { omniCoverage, sectorCoverage } from '@toposmith/schema';
import {
  COVERAGE_EDGE_TOL_PX,
  angleFromPointer,
  azimuthFromPointer,
  azimuthGrabOffset,
  coverageHandlePoint,
  coverageHitTest,
  coverageView,
  coverageViews,
  isCoverageProvider,
  patchFromDrag,
  radiusFromPointer,
} from '../coverage';
import { deviceCenter } from '@toposmith/schema';

/** 一台带覆盖的 AP（卡片 152×86，中心在 (76,43)） */
function ap(coverage: ReturnType<typeof omniCoverage>, x = 0, y = 0, id = 'dev-ap') {
  const device = instantiate('ap', id, 'AP', x, y);
  device.wireless = { ...(device.wireless ?? { mode: 'ap' as const }), coverage };
  return device;
}

const center = (device: ReturnType<typeof ap>) => deviceCenter(device);

describe('覆盖视图', () => {
  it('只有「提供接入」且启用覆盖的设备才有覆盖视图', () => {
    const provider = ap(omniCoverage(30));
    expect(isCoverageProvider(provider)).toBe(true);
    expect(coverageView(provider)?.radiusWorld).toBe(600); // 30 m × 20 u/m

    const disabled = ap({ ...omniCoverage(30), enabled: false });
    expect(isCoverageProvider(disabled)).toBe(false);
    expect(coverageView(disabled)).toBeNull();

    const client = instantiate('pc-laptop', 'dev-lap', '笔记本', 0, 0);
    expect(coverageView(client)).toBeNull();
  });

  it('覆盖列表按设备遍历顺序输出（确定性）', () => {
    const devices = [
      ap(omniCoverage(30), 0, 0, 'dev-ap-1'),
      instantiate('switch-8-1g', 'dev-sw', 'SW', 0, 0),
      ap(omniCoverage(10), 500, 0, 'dev-ap-2'),
    ];
    expect(coverageViews(devices).map((v) => v.deviceId)).toEqual(['dev-ap-1', 'dev-ap-2']);
  });
});

describe('手柄位置', () => {
  it('全向：半径手柄在正右方 r 处', () => {
    const device = ap(omniCoverage(30));
    const view = coverageView(device)!;
    const handle = coverageHandlePoint(view, 'radius');
    expect(handle.x).toBeCloseTo(center(device).x + 600, 5);
    expect(handle.y).toBeCloseTo(center(device).y, 5);
  });

  it('定向：半径/旋转手柄在角平分线上，角度手柄在两条弧边端点', () => {
    const device = ap(sectorCoverage(40, 90, 0));
    const view = coverageView(device)!;
    const c = center(device);

    const radius = coverageHandlePoint(view, 'radius');
    expect(radius.x).toBeCloseTo(c.x + 800, 5);

    const rotate = coverageHandlePoint(view, 'rotate');
    expect(rotate.x).toBeCloseTo(c.x + 400, 5);

    // 朝向 0°、开合 90° → 两条弧边在 ±45°
    const upper = coverageHandlePoint(view, 'angle', 1);
    const lower = coverageHandlePoint(view, 'angle', -1);
    expect(upper.x).toBeCloseTo(c.x + 800 * Math.cos(Math.PI / 4), 4);
    expect(upper.y).toBeCloseTo(c.y + 800 * Math.sin(Math.PI / 4), 4);
    expect(lower.y).toBeCloseTo(c.y - 800 * Math.sin(Math.PI / 4), 4);
  });
});

describe('命中判定', () => {
  const tol = COVERAGE_EDGE_TOL_PX;

  it('抓住半径手柄 → radius', () => {
    const view = coverageView(ap(omniCoverage(30)))!;
    const at = coverageHandlePoint(view, 'radius');
    const hit = coverageHitTest([view], { x: at.x + 2, y: at.y + 2 }, tol);
    expect(hit?.handle).toBe('radius');
  });

  it('抓住圆环本体（远离手柄）→ 也是拖半径', () => {
    const device = ap(omniCoverage(30));
    const view = coverageView(device)!;
    const c = center(device);
    // 正上方贴边：既不是手柄，也在弧上
    const hit = coverageHitTest([view], { x: c.x, y: c.y - 600 + 2 }, tol);
    expect(hit?.handle).toBe('radius');
  });

  it('圆内远离边缘的地方不命中（否则圈内就没法框选了）', () => {
    const device = ap(omniCoverage(30));
    const view = coverageView(device)!;
    const c = center(device);
    expect(coverageHitTest([view], { x: c.x + 300, y: c.y + 300 }, tol)).toBeNull();
    expect(coverageHitTest([view], { x: c.x, y: c.y }, tol)).toBeNull();
  });

  it('边不允许命中时（指针下有设备卡片）→ 只剩显式手柄', () => {
    const device = ap(omniCoverage(30));
    const view = coverageView(device)!;
    const c = center(device);
    const onEdge = { x: c.x, y: c.y - 600 + 2 };
    expect(coverageHitTest([view], onEdge, tol, { edgeAllowed: false })).toBeNull();
    const at = coverageHandlePoint(view, 'radius');
    expect(coverageHitTest([view], at, tol, { edgeAllowed: false })?.handle).toBe('radius');
  });

  it('扇形：抓弧边是半径，抓半径边是朝向，弧边之外的空处不命中', () => {
    const device = ap(sectorCoverage(40, 90, 0));
    const view = coverageView(device)!;
    const c = center(device);

    // 弧边（朝向 0°，正右方）
    expect(coverageHitTest([view], { x: c.x + 800 - 3, y: c.y }, tol)?.handle).toBe('radius');
    // 半径边（+45° 那条射线上、半径中点）
    const onRadial = {
      x: c.x + 400 * Math.cos(Math.PI / 4),
      y: c.y + 400 * Math.sin(Math.PI / 4),
    };
    expect(coverageHitTest([view], onRadial, tol)?.handle).toBe('rotate');
    // 扇形背面的同半径处：那里没有线，不命中
    expect(coverageHitTest([view], { x: c.x - 800 + 3, y: c.y }, tol)).toBeNull();
  });

  it('多个覆盖重叠时取最近的一个', () => {
    const near = coverageView(ap(omniCoverage(30), 0, 0, 'dev-near'))!;
    const far = coverageView(ap(omniCoverage(30), 4000, 0, 'dev-far'))!;
    const hit = coverageHitTest([far, near], coverageHandlePoint(near, 'radius'), tol);
    expect(hit?.view.deviceId).toBe(near.deviceId);
  });
});

describe('拖动换算', () => {
  it('半径：指针到圆心的距离按 20 u/m 换算成米', () => {
    const device = ap(omniCoverage(30));
    const view = coverageView(device)!;
    const c = center(device);
    expect(radiusFromPointer(view, { x: c.x + 1000, y: c.y })).toBe(50);
    expect(radiusFromPointer(view, { x: c.x, y: c.y - 200 })).toBe(10);
    // 钳制到下限 1 m
    expect(radiusFromPointer(view, { x: c.x + 4, y: c.y })).toBe(1);
  });

  it('开合角：相对角平分线的夹角翻倍（扇形两侧对称张开）', () => {
    const device = ap(sectorCoverage(30, 90, 0));
    const view = coverageView(device)!;
    const c = center(device);
    // 指针在 30° 方向 → 开合角 60°
    const at30 = { x: c.x + 500 * Math.cos(Math.PI / 6), y: c.y + 500 * Math.sin(Math.PI / 6) };
    expect(angleFromPointer(view, at30)).toBe(60);
    // 指针正好在角平分线上 → 收到下限
    expect(angleFromPointer(view, { x: c.x + 500, y: c.y })).toBe(5);
  });

  it('朝向：按抓取偏移量算，拖动过程中扇形不跳', () => {
    const device = ap(sectorCoverage(30, 90, 0));
    const view = coverageView(device)!;
    const c = center(device);
    const grab = { x: c.x + 300, y: c.y + 300 }; // 方位角 45°，朝向 0° → 偏移 45°
    const offset = azimuthGrabOffset(view, grab);
    expect(offset).toBeCloseTo(45, 5);
    // 指针转到 135° → 朝向应为 90°
    const moved = { x: c.x - 300, y: c.y + 300 };
    expect(azimuthFromPointer(view, moved, offset)).toBe(90);
  });

  it('回写：全向只改半径、定向保留角度与朝向', () => {
    const omni = coverageView(ap(omniCoverage(30)))!;
    expect(patchFromDrag(omni, { radiusM: 55 })).toEqual({ shape: 'omni', radiusM: 55 });

    const sector = coverageView(ap(sectorCoverage(30, 90, 45)))!;
    expect(patchFromDrag(sector, { radiusM: 20 })).toEqual({
      shape: 'sector',
      radiusM: 20,
      angleDeg: 90,
      azimuthDeg: 45,
    });
    expect(patchFromDrag(sector, { azimuthDeg: 400 }).azimuthDeg).toBe(40);
    expect(patchFromDrag(sector, { angleDeg: 999 }).angleDeg).toBe(360);
  });
});
