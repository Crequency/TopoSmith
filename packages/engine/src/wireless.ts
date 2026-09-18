/**
 * 无线信号测量（`measureWireless`）
 *
 * 回答画布上**任意一点**的问题：这里能收到哪些无线信号、它们各自什么质量、
 * 信道挤不挤。它是"站在现场看手机上的 WiFi 分析仪"的等价物 ——
 * 与诊断的区别在于：诊断问"从 A 能不能到 B"，测量问"这一点有什么"。
 *
 * 三条纪律（与引擎其余部分一致）：
 *  1. **纯函数**：只吃 `World` 与一个世界坐标点，不碰时钟与随机数（NFR-03）；
 *  2. **口径与诊断一致**：能收到 = 该点落在提供方**启用的覆盖区域**内。
 *     超出覆盖＝收不到，不额外编造"边缘还能勉强收到"的中间态（D-57）；
 *  3. **简化写在明处**：电平是**自由空间**估算（不含墙体、家具、天线方向图），
 *     速率是标称值打折，都在 `notes` 里如实列出（NFR 的"披露已知简化"）。
 */

import {
  coverageEnabled,
  coverageGeometry,
  deviceCenter,
  isCellularStandard,
  worldToMeters,
  type Device,
  type Point,
  type RadioStandard,
  type WifiBand,
} from '@toposmith/schema';
import { RADIO_STANDARD_LABEL, RADIO_TX_DBM, radioChannelFrequencyMhz, radioNominalMbps } from '@toposmith/catalog';
import type { World } from './model';
import { linksOfPort } from './graph';

/** 信号质量的档位（给 UI 用稳定的机器可读值，文案由 UI 决定） */
export type SignalQuality = 'excellent' | 'good' | 'fair' | 'weak';

/** 一条"这一点能收到的信号" */
export interface MeasuredSignal {
  deviceId: string;
  deviceName: string;
  /** 无线口所在端口名（用户要照着去改配置） */
  portName: string;
  isCellular: boolean;
  standard: RadioStandard;
  band?: WifiBand;
  channel?: number;
  ssid?: string;
  plmn?: string;
  /** 该点与该提供方卡片中心的距离（米） */
  distanceM: number;
  /** 覆盖半径（米） */
  radiusM: number;
  /** 覆盖余量（米）：离覆盖边缘还有多远 */
  marginM: number;
  /** 几何质量 0–1：圆心附近为 1、覆盖边缘为 0 */
  quality: SignalQuality;
  /** 自由空间估算的接收电平（dBm，负数） */
  estimatedRssiDbm: number;
  /** 两端按制式协商出的标称速率（Mbps） */
  nominalMbps: number;
  /** 估算可用速率（Mbps）：标称 × 半双工共享效率 × 质量系数 ÷ 并发终端数 */
  estimatedMbps: number;
  /** 同一提供方上已关联的终端数（共享介质的分母，含本点若接入） */
  peers: number;
}

/** 某个（频段，信道）上都有谁 */
export interface ChannelUsage {
  band: WifiBand | 'cellular';
  /** 信道号；蜂窝没有信道概念，用 0 占位 */
  channel: number;
  /** 代表频点（MHz），用于估算与展示 */
  frequencyMhz: number;
  signals: MeasuredSignal[];
  /** 干扰判定：同频（多个提供方挤在同一信道）/ 邻频（2.4G 相邻信道重叠）/ 无 */
  interference: 'none' | 'co-channel' | 'adjacent';
}

export interface WirelessMeasurement {
  point: Point;
  /** 按质量从好到差排序的可接收信号 */
  signals: MeasuredSignal[];
  /** 按频段 + 信道聚合的信道占用 */
  channels: ChannelUsage[];
  /** 质量最好的那一个（客户端实际上最可能选它） */
  best: MeasuredSignal | null;
  /** 已知简化与口径披露（UI 必须如实展示） */
  notes: string[];
}

/** 半双工共享介质效率：与带宽诊断同一条口径（docs/05-engine.md §5） */
const SHARED_MEDIUM_EFFICIENCY = 0.5;
/**
 * 质量 → 速率系数：覆盖边缘不是"完全不能用"，而是"只能跑低阶调制"。
 * 取 0.35（边缘）→ 1.0（圆心）的线性折算，是一个**工程近似**，
 * 不是 MCS 表 —— 界面上会写明"估算"。
 */
function qualityFactor(qualityRatio: number): number {
  return 0.35 + 0.65 * qualityRatio;
}

/**
 * 几何质量 → 档位。四档的边界是**产品口径**（用户在面板上看到"极佳/良好/一般/较弱"），
 * 不是协议里的 RSSI 分档：`ratio` 是"离圆心多近"，与墙体和干扰无关。
 */
function qualityOf(ratio: number): SignalQuality {
  if (ratio >= 0.6) return 'excellent';
  if (ratio >= 0.3) return 'good';
  if (ratio >= 0.12) return 'fair';
  return 'weak';
}

/**
 * 自由空间路径损耗（dB）：`20·log10(d_m) + 20·log10(f_MHz) − 27.55`。
 *
 * 距离下限取 1 m：贴脸时对数会发散，而真机上近场也不服从远场公式。
 */
function freeSpaceLossDb(distanceM: number, frequencyMhz: number): number {
  const d = Math.max(1, distanceM);
  return 20 * Math.log10(d) + 20 * Math.log10(frequencyMhz) - 27.55;
}

/** 同一提供方（无线口）上已关联的终端数 */
function peersOn(world: World, device: Device): number {
  const radio = device.ports.find((port) => port.medium === 'wifi');
  if (!radio) return 0;
  return linksOfPort(world, device.id, radio.id).filter((link) => link.up).length;
}

/**
 * 测量一个世界坐标点上的无线环境。
 *
 * @param world 推演世界（只读）
 * @param point 测量点（世界坐标）
 */
export function measureWireless(world: World, point: Point): WirelessMeasurement {
  const signals: MeasuredSignal[] = [];

  for (const device of world.ordered) {
    const radio = device.wireless;
    if (!radio || radio.mode !== 'ap') continue;
    if (!coverageEnabled(radio.coverage)) continue;
    const coverage = radio.coverage;
    if (!coverage) continue;

    const geometry = coverageGeometry(coverage);
    const center = deviceCenter(device);
    const distanceWorld = Math.hypot(point.x - center.x, point.y - center.y);
    if (distanceWorld > geometry.radiusWorld) continue; // 超出覆盖＝收不到（与诊断同一条口径）

    // 扇形：方向不满足同样收不到
    const bearing = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
    if (geometry.shape === 'sector') {
      const delta = Math.abs(((bearing - geometry.azimuthDeg + 540) % 360) - 180);
      if (delta > geometry.angleDeg / 2) continue;
    }

    const distanceM = worldToMeters(distanceWorld);
    const radiusM = geometry.radiusM;
    const ratio = radiusM <= 0 ? 1 : Math.max(0, 1 - distanceM / radiusM);
    const standard = radio.standard ?? '802.11ax';
    const frequencyMhz = radioChannelFrequencyMhz(standard, radio.band, radio.channel);
    const txDbm = RADIO_TX_DBM[standard] ?? 20;
    const nominalMbps = radioNominalMbps(standard, radio.band);
    const peers = peersOn(world, device);
    const port = device.ports.find((p) => p.medium === 'wifi');

    signals.push({
      deviceId: device.id,
      deviceName: device.name,
      portName: port?.name ?? 'WLAN',
      isCellular: isCellularStandard(standard),
      standard,
      band: radio.band,
      channel: radio.channel,
      ssid: radio.ssid,
      plmn: radio.plmn,
      distanceM: Math.round(distanceM * 10) / 10,
      radiusM,
      marginM: Math.round((radiusM - distanceM) * 10) / 10,
      quality: qualityOf(ratio),
      estimatedRssiDbm: Math.round(txDbm - freeSpaceLossDb(distanceM, frequencyMhz)),
      nominalMbps,
      estimatedMbps: Math.round(
        (nominalMbps * SHARED_MEDIUM_EFFICIENCY * qualityFactor(ratio)) / Math.max(1, peers + 1),
      ),
      peers,
    });
  }

  // 质量优先，其次标称速率，最后按设备 id 保证确定性
  const rank = { excellent: 3, good: 2, fair: 1, weak: 0 } as const;
  signals.sort(
    (a, b) =>
      rank[b.quality] - rank[a.quality] ||
      b.nominalMbps - a.nominalMbps ||
      a.deviceId.localeCompare(b.deviceId),
  );

  return {
    point,
    signals,
    channels: groupChannels(signals),
    best: signals[0] ?? null,
    notes: [
      '能收到 = 测量点落在该设备**已启用**的覆盖范围内（超出覆盖＝收不到），与诊断的判定口径一致。',
      `接收电平按**自由空间**估算（20·log10(d) + 20·log10(f) − 27.55，发射功率按设备类型取典型值），**不含**墙体、家具与天线方向图的衰减 —— 室内实测通常比这个数字低 10–20 dB。`,
      `估算速率 = 标称速率 × ${SHARED_MEDIUM_EFFICIENCY}（半双工共享介质）× 质量系数 ÷ 该提供方上已有终端数 + 1，是量级参考，不是 MCS 速率表。`,
      '蜂窝信道没有"信道号"的概念，按制式代表频点（LTE 1.8 GHz / NR 3.5 GHz）估算。',
    ],
  };
}

/** 按（频段，信道）聚合，并判定同频 / 邻频干扰 */
function groupChannels(signals: MeasuredSignal[]): ChannelUsage[] {
  const groups = new Map<string, ChannelUsage>();

  for (const signal of signals) {
    const cellular = signal.isCellular;
    const band: WifiBand | 'cellular' = cellular ? 'cellular' : (signal.band ?? '5G');
    const channel = cellular ? 0 : (signal.channel ?? 0);
    const key = `${band}:${channel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.signals.push(signal);
      continue;
    }
    groups.set(key, {
      band,
      channel,
      frequencyMhz: radioChannelFrequencyMhz(signal.standard, signal.band, signal.channel),
      signals: [signal],
      interference: 'none',
    });
  }

  const list = [...groups.values()];
  for (const usage of list) {
    if (usage.signals.length > 1) usage.interference = 'co-channel';
  }

  /*
   * 2.4 GHz 的相邻信道互相重叠（只有 1/6/11 三条互不重叠）；5G/6G 的信道是正交的，
   * 只有同频才算干扰。
   *
   * 判据只看"有没有别的信道在 5 个信道以内"，**不看对方被标成了什么** ——
   * 用对方的状态做条件会让结果依赖遍历顺序（ch1 先被标成邻频，ch3 就看不见它了），
   * 而"这两个信道互相重叠"本来就是一个对称关系。
   */
  const wifi24 = list.filter((usage) => usage.band === '2.4G');
  for (const usage of wifi24) {
    if (usage.interference !== 'none') continue; // 同频是更强的结论，不再叠加邻频
    const overlapping = wifi24.some(
      (other) => other.channel !== usage.channel && Math.abs(other.channel - usage.channel) < 5,
    );
    if (overlapping) usage.interference = 'adjacent';
  }

  return list.sort(
    (a, b) => a.band.localeCompare(b.band) || a.channel - b.channel,
  );
}

/** 供 UI 复用：测量点到各提供方的距离文案 */
export function formatDistanceM(meters: number): string {
  return meters >= 100 ? `${Math.round(meters)} m` : `${meters.toFixed(1)} m`;
}

export { RADIO_STANDARD_LABEL };
