/**
 * 无线关联动画（独立覆盖层）
 *
 * 无线关联不画线，改用动画表达"这一刻是通的、以什么方式在传"：
 *   · **覆盖圈**说明"能服务到哪"（`draw.ts` 的 drawCoverages）；
 *   · **动画**说明"这条关联此刻是怎么通的"（本文件分组 + `signal-styles.ts` 的九种形态）。
 *
 * 分组是这一版的关键：动画按**提供方**分组绘制（一台设备 + 它的全部对端），
 * 因为好几种形态本来就是"一对多"的 —— Massive MIMO 要从一个阵列同时射向多台设备、
 * 涟漪要按最远的那台决定扩散范围、蜂窝网格要把终端在小区之间搬。逐条链路画做不到这些。
 *
 * 为什么单独一层画布：动画是**常驻**的。若画进主场景，每一帧都要重画 800 条连线与
 * 700 多张卡片（实测十几毫秒一帧），为了几个图元让常驻 rAF 烧掉半个核，
 * 与"静止时不烧 CPU"的既有约定（FR-50）冲突。覆盖层只有几个图元，一帧不到 0.1 ms。
 *
 * 这一层是**纯绘制**：相位由调用方推进（`SignalParams.phase`），
 * 因此"降低动效"只要不推进相位即可得到一张静态图 —— 不需要在这里分支。
 */

import { worldToScreen } from './draw';
import { coverageView } from '../lib/coverage';
import { deviceCenter, metersToWorld, type Device, type Point } from '@toposmith/schema';
import { radioChannelFrequencyMhz } from '@toposmith/catalog';
import { resolveAnimationStyle, type WirelessAnimationSetting } from '../lib/settings';
import {
  drawProviderGroup,
  tintOfDevice,
  waveFrontRadius,
  waveFrontRatios,
  waveFronts,
  type ProviderGroup,
  type WaveFront,
} from './signal-styles';
import type { DerivedLink, World } from '@toposmith/anvil';
import type { Viewport } from '../state/store';

// 形态的几何与绘制都在 signal-styles.ts；这里转出来，老引用路径（单测/脚本）继续可用
export { waveFrontRadius, waveFrontRatios, waveFronts, type WaveFront };

export interface SignalParams {
  world: World;
  camera: Viewport;
  width: number;
  height: number;
  /** 动画相位（0–1）。调用方按时间推进；不推进就是静态图 */
  phase: number;
  /** 用户的无线动画设置（统一覆盖 / 遵照设备），决定每台设备实际用哪种形态 */
  animation: WirelessAnimationSetting;
}

/** 需要画动画的无线关联：覆盖场景下、且当下是通的 */
export function signalLinks(world: World): DerivedLink[] {
  const out: DerivedLink[] = [];
  for (const link of world.links) {
    if (link.family !== 'wireless' || !link.up) continue;
    const a = world.devices.get(link.a.deviceId);
    const b = world.devices.get(link.b.deviceId);
    if ((a && coverageView(a)) || (b && coverageView(b))) out.push(link);
  }
  return out;
}

/** 提供覆盖的那一端（信号从它发出）；两端都提供时取 a 端 */
export function providerEndOf(world: World, link: DerivedLink): 'a' | 'b' {
  const a = world.devices.get(link.a.deviceId);
  const b = world.devices.get(link.b.deviceId);
  if (a && coverageView(a)) return 'a';
  if (b && coverageView(b)) return 'b';
  return 'a';
}

/**
 * 把无线关联按**提供方**分组，并解析出每台设备实际使用的动画形态。
 *
 * 分组顺序按设备 id 排序（确定性）：同一份拓扑每次画出来的层次一致，
 * 端到端脚本也能稳定断言。
 */
export function providerGroups(
  world: World,
  camera: Viewport,
  animation: WirelessAnimationSetting,
): ProviderGroup[] {
  const byProvider = new Map<string, { device: Device; peers: Map<string, Device> }>();

  for (const link of signalLinks(world)) {
    const providerIsA = providerEndOf(world, link) === 'a';
    const providerId = providerIsA ? link.a.deviceId : link.b.deviceId;
    const peerId = providerIsA ? link.b.deviceId : link.a.deviceId;
    const provider = world.devices.get(providerId);
    const peer = world.devices.get(peerId);
    if (!provider || !peer) continue;
    const entry = byProvider.get(providerId) ?? { device: provider, peers: new Map() };
    entry.peers.set(peerId, peer);
    byProvider.set(providerId, entry);
  }

  const groups: ProviderGroup[] = [];
  for (const [deviceId, entry] of [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const device = entry.device;
    const peers = [...entry.peers.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, d]) => d);
    const centerWorld = deviceCenter(device);
    const center = worldToScreen(camera, centerWorld.x, centerWorld.y);
    const coverage = device.wireless?.coverage;
    groups.push({
      deviceId,
      device,
      center,
      // 覆盖半径换算成屏幕像素：蜂窝网格的六边形小区按它画
      coverageRadiusPx: coverage ? metersToWorld(coverage.radiusM) * camera.k : 0,
      style: resolveAnimationStyle(animation, device.wireless?.animation),
      tint: tintOfDevice(device),
      peers: peers.map((peer) => {
        const peerWorld = deviceCenter(peer);
        const point = worldToScreen(camera, peerWorld.x, peerWorld.y);
        return {
          linkId: `${deviceId}->${peer.id}`,
          peerDeviceId: peer.id,
          device: peer,
          center: point,
          distancePx: Math.hypot(point.x - center.x, point.y - center.y),
        };
      }),
    });
  }
  return groups;
}

/** 一组的**代表频点**（MHz）：电磁波的波长按它算（频率越高越密） */
export function groupFrequencyMhz(group: ProviderGroup): number {
  const radio = group.device.wireless;
  return radioChannelFrequencyMhz(radio?.standard ?? '802.11ax', radio?.band, radio?.channel);
}

/** 一条关联的几何（屏幕坐标）：发射端 = 提供方卡片中心，接收端 = 对端卡片中心 */
export interface SignalGeometry {
  linkId: string;
  providerDeviceId: string;
  peerDeviceId: string;
  from: Point;
  to: Point;
  radius: number;
  fronts: WaveFront[];
}

/**
 * 单独一条关联的几何。
 *
 * 只对**信号波**（默认形态）有意义 —— 它是唯一"一条链路一组弧"的形态；
 * 端到端脚本用它断言"以卡片中心为原点、沿直线、每组三条弧"。
 */
export function signalGeometry(
  world: World,
  camera: Viewport,
  link: DerivedLink,
  phase: number,
): SignalGeometry | null {
  const providerIsA = providerEndOf(world, link) === 'a';
  const providerId = providerIsA ? link.a.deviceId : link.b.deviceId;
  const peerId = providerIsA ? link.b.deviceId : link.a.deviceId;
  const fromDevice = world.devices.get(providerId);
  const toDevice = world.devices.get(peerId);
  if (!fromDevice || !toDevice) return null;

  // 以**卡片中心**为原点（不是端口位置）：画的是"设备之间在传"
  const fromWorld = deviceCenter(fromDevice);
  const toWorld = deviceCenter(toDevice);
  const from = worldToScreen(camera, fromWorld.x, fromWorld.y);
  const to = worldToScreen(camera, toWorld.x, toWorld.y);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 24) return null; // 两张卡片几乎重叠：没有"传递"可言

  const radius = waveFrontRadius(camera.k);
  return {
    linkId: link.id,
    providerDeviceId: providerId,
    peerDeviceId: peerId,
    from,
    to,
    radius,
    fronts: waveFronts(from, to, phase, radius),
  };
}

/**
 * 画一帧动画。返回屏幕上真正画出来的**关联条数**（覆盖层据此决定要不要继续跑）。
 *
 * 调用方负责先 `clearRect`：这一层是完全透明的覆盖层，只画动画本身。
 */
export function drawSignals(ctx: CanvasRenderingContext2D, params: SignalParams): number {
  const { world, camera, phase } = params;
  if (signalLinks(world).length === 0) return 0;

  const margin = 160;
  let drawn = 0;

  for (const group of providerGroups(world, camera, params.animation)) {
    // 整组（含覆盖半径：蜂窝网格按它画）都在视口外就跳过
    const reach = Math.max(group.coverageRadiusPx, ...group.peers.map((peer) => peer.distancePx), 40);
    if (
      group.center.x + reach + margin < 0 ||
      group.center.x - reach - margin > params.width ||
      group.center.y + reach + margin < 0 ||
      group.center.y - reach - margin > params.height
    ) {
      continue;
    }

    drawProviderGroup({
      ctx,
      group,
      phase,
      zoom: camera.k,
      frequencyMhz: groupFrequencyMhz(group),
    });
    drawn += group.peers.length;
  }
  return drawn;
}
