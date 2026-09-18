/**
 * 无线信号测量单测（`measureWireless`）
 *
 * 钉住三件事：
 *  1. **口径**：能收到 = 落在提供方启用的覆盖内（含定向扇区的方向判定），与诊断一致；
 *  2. **数字**：距离/余量按 1 米 = 20 世界单位；电平按自由空间公式（换频点就换数字）；
 *  3. **信道聚合**：同频、2.4G 邻频重叠、蜂窝单独成组。
 */

import { describe, expect, it } from 'vitest';
import { instantiate } from '@toposmith/catalog';
import {
  SCHEMA_VERSION,
  deviceCenter,
  omniCoverage,
  sectorCoverage,
  type Cable,
  type Device,
  type Scenario,
} from '@toposmith/schema';
import { buildWorld } from '../model';
import { formatDistanceM, measureWireless } from '../wireless';

/** 造一台带给定无线配置的设备 */
function radio(
  key: string,
  id: string,
  name: string,
  x: number,
  y: number,
  wireless: Device['wireless'],
): Device {
  const device = instantiate(key, id, name, x, y);
  device.wireless = wireless;
  return device;
}

function world(devices: Device[], cables: Cable[] = []) {
  const scenario: Scenario = {
    schemaVersion: SCHEMA_VERSION,
    id: 'wireless-fixture',
    name: 'wireless fixture',
    devices,
    cables,
    updatedAt: '2026-09-18T00:00:00.000Z',
  };
  return buildWorld(scenario);
}

const AP_AX = {
  mode: 'ap' as const,
  ssid: 'Lab',
  band: '5G' as const,
  standard: '802.11ax' as const,
  channel: 149,
  coverage: omniCoverage(30),
};

/** 距某设备卡片中心 `meters` 米、正右方的一点（世界坐标） */
function pointRightOf(device: Device, meters: number) {
  const center = deviceCenter(device);
  return { x: center.x + meters * 20, y: center.y };
}

describe('无线信号测量：口径', () => {
  it('覆盖圈内能收到，圈外收不到', () => {
    const ap = radio('ap', 'dev-ap', 'AP', 0, 0, AP_AX);
    const w = world([ap]);

    expect(measureWireless(w, pointRightOf(ap, 10)).signals).toHaveLength(1);
    expect(measureWireless(w, pointRightOf(ap, 30)).signals).toHaveLength(1); // 边界上仍在覆盖内
    expect(measureWireless(w, pointRightOf(ap, 31)).signals).toHaveLength(0);
    expect(measureWireless(w, pointRightOf(ap, 31)).best).toBeNull();
  });

  it('定向扇形：朝向内收得到，背面收不到（哪怕距离更近）', () => {
    const bs = radio('bs-5g', 'dev-bs', '5G 基站', 0, 0, {
      mode: 'ap',
      standard: 'nr',
      plmn: '46000',
      coverage: sectorCoverage(100, 120, 0),
    });
    const w = world([bs]);
    const center = deviceCenter(bs);

    expect(measureWireless(w, { x: center.x + 1000, y: center.y }).signals).toHaveLength(1);
    // 正后方 5 m：距离更近，但方向不满足
    expect(measureWireless(w, { x: center.x - 100, y: center.y }).signals).toHaveLength(0);
  });

  it('关掉覆盖（enabled: false）→ 收不到，与诊断一致', () => {
    const ap = radio('ap', 'dev-ap', 'AP', 0, 0, {
      ...AP_AX,
      coverage: { ...omniCoverage(30), enabled: false },
    });
    expect(measureWireless(world([ap]), pointRightOf(ap, 5)).signals).toHaveLength(0);
  });

  it('客户端（mode: sta）不产生信号 —— 只有提供方才有覆盖', () => {
    const laptop = radio('pc-laptop', 'dev-lap', '笔记本', 0, 0, {
      mode: 'sta',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
    });
    expect(measureWireless(world([laptop]), pointRightOf(laptop, 5)).signals).toHaveLength(0);
  });
});

describe('无线信号测量：数字', () => {
  it('距离、余量、质量档位与估算电平都按口径给出', () => {
    const ap = radio('ap', 'dev-ap', 'AP', 0, 0, AP_AX);
    const w = world([ap]);

    const near = measureWireless(w, pointRightOf(ap, 10));
    const signal = near.signals[0]!;
    expect(signal.deviceName).toBe('AP');
    expect(signal.portName).toBe('WLAN');
    expect(signal.distanceM).toBe(10);
    expect(signal.radiusM).toBe(30);
    expect(signal.marginM).toBe(20);
    expect(signal.quality).toBe('excellent');
    // 自由空间 @10 m / 5745 MHz（信道 149）：20 − (20·log10(10) + 20·log10(5745) − 27.55) ≈ −48 dBm
    expect(signal.estimatedRssiDbm).toBe(-48);
    expect(signal.nominalMbps).toBe(1201);
    // 1201 × 0.5 × (0.35 + 0.65×0.667) ÷ 1 ≈ 470
    expect(signal.estimatedMbps).toBe(470);

    const edge = measureWireless(w, pointRightOf(ap, 28)).signals[0]!;
    expect(edge.quality).toBe('weak');
    expect(edge.estimatedRssiDbm).toBeLessThan(signal.estimatedRssiDbm); // 越远越弱
    expect(edge.estimatedMbps).toBeLessThan(signal.estimatedMbps);
  });

  it('换频段就换数字：2.4G 同距离的损耗更小（频点更低）', () => {
    const ap5 = radio('ap', 'dev-ap-5', 'AP-5G', 0, 0, AP_AX);
    const ap24 = radio('ap', 'dev-ap-24', 'AP-2.4G', 4000, 0, {
      ...AP_AX,
      band: '2.4G',
      standard: '802.11n',
      channel: 6,
    });
    const w = world([ap5, ap24]);
    const at5 = measureWireless(w, pointRightOf(ap5, 10)).signals[0]!;
    const at24 = measureWireless(w, pointRightOf(ap24, 10)).signals[0]!;
    expect(at24.estimatedRssiDbm).toBeGreaterThan(at5.estimatedRssiDbm);
    expect(at24.nominalMbps).toBe(150); // 802.11n @2.4G = 150 Mbps（目录口径）
  });

  it('蜂窝基站用宏站发射功率，电平明显更强', () => {
    const bs = radio('bs-4g', 'dev-bs', '4G 基站', 0, 0, {
      mode: 'ap',
      standard: 'lte',
      plmn: '46000',
      coverage: omniCoverage(200),
    });
    const signal = measureWireless(world([bs]), pointRightOf(bs, 50)).signals[0]!;
    expect(signal.isCellular).toBe(true);
    expect(signal.plmn).toBe('46000');
    expect(signal.nominalMbps).toBe(150);
    // 43 dBm 发射、1.8 GHz、50 m：损耗 ≈ 71.5 dB → 约 −29 dBm
    expect(signal.estimatedRssiDbm).toBeGreaterThan(-35);
    expect(signal.estimatedRssiDbm).toBeLessThan(-20);
  });

  it('同一提供方上已有终端 → 并发数进分母，估算速率按人头摊薄', () => {
    const ap = radio('ap', 'dev-ap', 'AP', 0, 0, AP_AX);
    const laptop = radio('pc-laptop', 'dev-lap', '笔记本', 400, 0, {
      mode: 'sta',
      ssid: 'Lab',
      band: '5G',
      standard: '802.11ax',
    });
    const link: Cable = {
      id: 'cbl-1',
      type: 'wireless',
      lengthM: 0,
      a: { deviceId: 'dev-ap', portId: 'port-wlan' },
      b: { deviceId: 'dev-lap', portId: 'port-wlan' },
    };
    const withPeer = measureWireless(world([ap, laptop], [link]), pointRightOf(ap, 10)).signals[0]!;
    const alone = measureWireless(world([ap]), pointRightOf(ap, 10)).signals[0]!;
    expect(withPeer.peers).toBe(1);
    expect(alone.peers).toBe(0);
    expect(withPeer.estimatedMbps).toBe(Math.round(alone.estimatedMbps / 2));
  });

  it('多条信号按质量排序，best 是质量最好的那个', () => {
    const near = radio('ap', 'dev-near', '近 AP', 0, 0, { ...AP_AX, coverage: omniCoverage(30) });
    // 远的这台覆盖半径 200 m 且中心在 100 m 外 —— 测量点仍在它的覆盖里，只是质量更差
    const far = radio('ap', 'dev-far', '远 AP', 2000, 0, { ...AP_AX, coverage: omniCoverage(200) });
    const w = world([near, far]);
    const result = measureWireless(w, pointRightOf(near, 4));
    expect(result.signals.map((s) => s.deviceName)).toEqual(['近 AP', '远 AP']);
    expect(result.best?.deviceName).toBe('近 AP');
    // 同一输入两次结果一致（确定性）
    expect(JSON.stringify(measureWireless(w, pointRightOf(near, 4)))).toBe(JSON.stringify(result));
  });
});

describe('无线信号测量：信道情况', () => {
  it('两个 AP 同频 → 同一组并标记同频干扰', () => {
    const a = radio('ap', 'dev-a', 'AP-A', 0, 0, AP_AX);
    const b = radio('ap', 'dev-b', 'AP-B', 400, 0, { ...AP_AX, coverage: omniCoverage(30) });
    const result = measureWireless(world([a, b]), pointRightOf(a, 5));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]!.interference).toBe('co-channel');
    expect(result.channels[0]!.signals).toHaveLength(2);
    expect(result.channels[0]!.frequencyMhz).toBe(5745);
  });

  it('5G 不同信道 → 互不干扰（正交信道）', () => {
    const a = radio('ap', 'dev-a', 'AP-A', 0, 0, AP_AX);
    const b = radio('ap', 'dev-b', 'AP-B', 400, 0, {
      ...AP_AX,
      channel: 44,
      coverage: omniCoverage(30),
    });
    const result = measureWireless(world([a, b]), pointRightOf(a, 5));
    expect(result.channels).toHaveLength(2);
    expect(result.channels.every((usage) => usage.interference === 'none')).toBe(true);
  });

  it('2.4G 相邻信道算邻频重叠，1/6/11 互不重叠', () => {
    const ch1 = radio('ap', 'dev-1', 'AP-ch1', 0, 0, {
      ...AP_AX,
      band: '2.4G',
      standard: '802.11n',
      channel: 1,
      coverage: omniCoverage(40),
    });
    const ch3 = radio('ap', 'dev-3', 'AP-ch3', 400, 0, {
      ...AP_AX,
      band: '2.4G',
      standard: '802.11n',
      channel: 3,
      coverage: omniCoverage(40),
    });
    const adjacent = measureWireless(world([ch1, ch3]), pointRightOf(ch1, 5));
    expect(adjacent.channels.map((usage) => usage.interference)).toEqual(['adjacent', 'adjacent']);

    const ch6 = radio('ap', 'dev-6', 'AP-ch6', 400, 0, {
      ...AP_AX,
      band: '2.4G',
      standard: '802.11n',
      channel: 6,
      coverage: omniCoverage(40),
    });
    const orthogonal = measureWireless(world([ch1, ch6]), pointRightOf(ch1, 5));
    expect(orthogonal.channels.every((usage) => usage.interference === 'none')).toBe(true);
  });

  it('蜂窝单独成组：没有信道号，只有 PLMN 与制式', () => {
    const bs = radio('bs-5g', 'dev-bs', '5G 基站', 0, 0, {
      mode: 'ap',
      standard: 'nr',
      plmn: '46000',
      coverage: omniCoverage(200),
    });
    const result = measureWireless(world([bs]), pointRightOf(bs, 50));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]!.band).toBe('cellular');
    expect(result.channels[0]!.channel).toBe(0);
    expect(result.channels[0]!.frequencyMhz).toBe(3500);
  });

  it('距离文案：小于 100 m 保留一位小数，超过就取整', () => {
    expect(formatDistanceM(0)).toBe('0.0 m');
    expect(formatDistanceM(19.64)).toBe('19.6 m');
    expect(formatDistanceM(99.9)).toBe('99.9 m');
    expect(formatDistanceM(100)).toBe('100 m');
    expect(formatDistanceM(1234.5)).toBe('1235 m');
  });

  it('哪都收不到时给空结果与口径说明（不编造信号）', () => {
    const result = measureWireless(world([]), { x: 0, y: 0 });
    expect(result.signals).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(result.best).toBeNull();
    expect(result.notes.length).toBeGreaterThanOrEqual(3);
  });
});
