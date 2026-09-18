import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { cardWidthOf, deviceFlipButtonRect, rackFlipButtonRect } from './lib/geometry';
import { portLayout } from './lib/ports';
import { pointAtRatio, nearestRatio } from './lib/polyline';
import { linkPath, deviceRect } from './render/draw';
import { coverageHandlePoint, coverageView } from './lib/coverage';
import { measureWireless } from '@toposmith/anvil';
import { signalLinks } from './render/signals';
import { worldContentBounds } from './lib/fit';
import { useApp } from './state/store';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

// 开发环境暴露状态句柄，供端到端冒烟脚本断言真实坐标与选择集。
// 生产构建下 `import.meta.env.DEV` 为 false，这段代码会被摇掉。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__toposmith'] = {
    getState: () => useApp.getState(),
    /** 端口图元中心（世界坐标）：让端到端脚本按真实布局点击，而不是猜像素 */
    portGlyphCenter: (deviceId: string, portId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      if (!device) return null;
      const glyph = portLayout(device).find((item) => item.port.id === portId);
      return glyph ? { x: glyph.centerX, y: glyph.centerY } : null;
    },
    /** 画布上机柜翻转按钮的中心（世界坐标） */
    rackFlipButtonCenter: (rackId: string) => {
      const device = useApp.getState().world.devices.get(rackId);
      if (!device?.rack) return null;
      const rect = rackFlipButtonRect(device);
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    },
    /** 设备卡片左边缘中心（世界坐标），用于拖动而不碰到端口条带 */
    deviceGrabPoint: (deviceId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      return device ? { x: device.x + 30, y: device.y + 20 } : null;
    },
    /** 某条链路速率标签的中心（世界坐标）：端到端脚本据此按住标签拖动（FR-46） */
    cableLabelCenter: (linkId: string) => {
      const state = useApp.getState();
      const link = state.world.links.find((item) => item.id === linkId);
      if (!link) return null;
      const path = linkPath(state.world, link);
      return path ? { x: path.labelPoint.x, y: path.labelPoint.y } : null;
    },
    /** 折线上的任意位置（世界坐标）：拖动标签时用来算"该拖到哪里" */
    cablePointAt: (linkId: string, ratio: number) => {
      const state = useApp.getState();
      const link = state.world.links.find((item) => item.id === linkId);
      if (!link) return null;
      const path = linkPath(state.world, link);
      return path
        ? { x: pointAtRatio(path.points, ratio).x, y: pointAtRatio(path.points, ratio).y }
        : null;
    },
    /** 设备卡片的矩形（世界坐标）：脚本据此采样"卡片是否变半透明"（FR-48） */
    deviceCardRect: (deviceId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      return device ? deviceRect(device) : null;
    },
    /** 画布可见内容的总范围（设备 ∪ 连线），"适应视图"用的就是它（FR-51） */
    contentBounds: () => worldContentBounds(useApp.getState().world),
    /** 设备卡片右上角翻转按钮的世界矩形（用真实几何，脚本别猜） */
    flipButtonRect: (deviceId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      if (!device) return null;
      return deviceFlipButtonRect({ x: device.x, y: device.y, w: cardWidthOf(device) });
    },
    /** 某台设备是否有背板端口（有 → 悬浮应半透明） */
    deviceHasRearPorts: (deviceId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      return device ? device.ports.some((port) => port.side === 'rear') : null;
    },
    /** 无线信号测量（FR-80）：端到端脚本用它核对面板上的数字与引擎一致 */
    measureAt: (x: number, y: number) => {
      const world = useApp.getState().world;
      const point = { x, y };
      const result = measureWireless(world, point);
      return {
        signals: result.signals,
        channels: result.channels,
        best: result.best,
        notes: result.notes,
      };
    },
    /** 覆盖区域的几何（世界坐标）：端到端脚本按真实圆心/半径点击手柄（D-56） */
    coverageGeometry: (deviceId: string) => {
      const device = useApp.getState().world.devices.get(deviceId);
      const view = device ? coverageView(device) : null;
      if (!view) return null;
      return {
        center: view.center,
        radiusWorld: view.radiusWorld,
        radiusM: view.coverage.radiusM,
        shape: view.shape,
        angleDeg: view.angleDeg,
        azimuthDeg: view.azimuthDeg,
      };
    },
    /** 覆盖手柄的世界坐标（拖拽脚本据此按住它） */
    coverageHandleAt: (deviceId: string, handle: 'radius' | 'angle' | 'rotate', side: 1 | -1 = 1) => {
      const device = useApp.getState().world.devices.get(deviceId);
      const view = device ? coverageView(device) : null;
      return view ? coverageHandlePoint(view, handle, side) : null;
    },
    /** 画信号波的那些关联（条数 = 覆盖层上应该有几组信号波） */
    signalLinkIds: () => signalLinks(useApp.getState().world).map((link) => link.id),
    /** 标签当前贴在连线上的位置：弧长比例 + 到折线的距离（应当为 0，FR-46） */
    labelProjection: (linkId: string) => {
      const state = useApp.getState();
      const link = state.world.links.find((item) => item.id === linkId);
      if (!link) return null;
      const path = linkPath(state.world, link);
      if (!path) return null;
      const projection = nearestRatio(path.points, path.labelPoint);
      return { ratio: projection.ratio, distance: projection.distance };
    },
  };
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
