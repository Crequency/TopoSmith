/**
 * 预置场景登记表
 *
 * 每个预置场景都是**产品内容**，不是示例数据：它们各自演示一类能力，
 * 并且被 `presets.test.ts` 逐个验证"宣传的行为真的成立"（能通的通、该报的错报对）。
 * 因此这里的元信息（summary / highlights）必须与场景实际内容一致 ——
 * 改场景就该改这里，改这里就该让测试继续过。
 */

import type { Scenario } from '@toposmith/schema';
import { buildHomeScenario } from './home';
import { buildOfficeScenario } from './office';
import { buildDatacenterScenario } from './datacenter';
import { buildFtthScenario } from './ftth';
import { buildCampusScenario } from './campus';
import { buildIdcScenario } from './idc';

export { buildEmptyScenario, buildHomeScenario } from './home';

export interface PresetMeta {
  /** 稳定 key（写进测试与文档，不要跟着文案改） */
  key: string;
  name: string;
  /** 一句话说明这个场景能看什么 */
  summary: string;
  /** 这个场景专门演示的点（UI 上做标签） */
  highlights: string[];
  /** 场景里"有意留的坑"，没有就不写 */
  pitfall?: string;
  build: () => Scenario;
}

export const PRESETS: PresetMeta[] = [
  {
    key: 'home',
    name: '家庭网络',
    summary:
      '光猫路由模式做 NAT 与 DHCP，交换机接有线终端，AP 提供无线，上行经 OLT 到云侧。开箱即可跑通四类诊断。',
    highlights: ['PON 接入', 'NAT + DHCP', '无线 + 有线同网段', 'DNS 转发链'],
    build: buildHomeScenario,
  },
  {
    key: 'office',
    name: '小微企业办公网',
    summary:
      '光猫出口 + 企业路由器带三个 VLAN（办公 1 / 访客 20 / 服务器 30），交换机与业务服务器装在机柜里。',
    highlights: ['VLAN 分段', '跨 VLAN 路由', '机柜上架', '一处配错可排查'],
    pitfall: '访客段上联口（交换机 GE23）忘打标，停在 VLAN 1 —— ping 门口摄像机会报「两端不在同一广播域」。',
    build: buildOfficeScenario,
  },
  {
    key: 'datacenter',
    name: '机房机柜',
    summary:
      '42U 机柜里装了 24 口交换机与三台 4U 服务器，空 U 位留着；服务器端口全在背面，可悬浮透视或翻面查看。',
    highlights: ['多 U 上架', '背面端口透视', '万兆 DAC', '带宽瓶颈定位'],
    build: buildDatacenterScenario,
  },
  {
    key: 'ftth',
    name: '光接入（两种光猫）',
    summary:
      '同一台 OLT 的两个 PON 口各带一个用户：A 户桥接光猫 + 自备路由器，B 户路由模式光猫一台搞定。',
    highlights: ['桥接 vs 路由光猫', '每 PON 一个网关', 'EPON 1G 协商降速', '用户间隔离'],
    build: buildFtthScenario,
  },
  {
    key: 'campus',
    name: '园区无线覆盖',
    summary:
      '三台 AP 同 SSID、频段与标准各不相同（2.4G n / 5G ac / 6G be），终端速率按两端较小值协商。',
    highlights: ['多 AP 同 SSID', 'WiFi 速率协商', '无线是共享介质', 'SSID 配错排查'],
    pitfall: '一台平板配错 SSID（Campus-2G），它的无线链路起不来 —— 画布上能看到 SSID 不一致的告警。',
    build: buildCampusScenario,
  },
  {
    key: 'idc',
    name: '中型托管 IDC',
    summary:
      '三个机房各 24 个 42U 机柜（柜内 1 台 ToR + 9 台 4U 服务器），双千兆上联到机房汇聚，' +
      '汇聚万兆到核心交换机对，出口路由器万兆出网；另有一个管理办公室。',
    highlights: ['3 机房 × 24 柜', '约 800 台设备', '满配机柜', '规模压测场景'],
    build: buildIdcScenario,
  },
];

export const DEFAULT_PRESET_KEY = 'home';

export function presetByKey(key: string): PresetMeta | undefined {
  return PRESETS.find((preset) => preset.key === key);
}

/** 场景规模（设备数 / 链路数），UI 上给用户一个"这个场景有多大"的预期 */
export function presetSize(preset: PresetMeta): { devices: number; cables: number } {
  const scenario = preset.build();
  return { devices: scenario.devices.length, cables: scenario.cables.length };
}
