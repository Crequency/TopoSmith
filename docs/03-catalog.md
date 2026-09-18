# 设备 / 端口 / 线缆目录（Catalog）

> 版本：v0.1（M0） ｜ 权威数据在 `packages/catalog/src/`
> 本文档解释**为什么**这些数字是这样，数值本身以代码为准。

## 1. 设计原则

1. **目录是数据，不是代码分支**。新增一个交换机型号 = 加一条数据；UI、引擎都不改。
2. **每个数字都要有出处**。速率、长度限制、分档关系写在 `standard` / `note` 字段里。
3. **俗名要标注**。用户说 CAT6e，标准说 CAT6a——两者都要在 UI 里出现，且必须说明关系。

## 2. 端口速率枚举

| 常量 | 速率 | 典型端口名 | 说明 |
|---|---|---|---|
| `eth100` | 100 Mbps | `FE1` | Fast Ethernet，老设备与 IP 摄像头常见 |
| `eth1g` | 1000 Mbps | `GE1` / `Gi1/0/1` | 千兆电口，家用与办公主流 |
| `eth2_5g` | 2500 Mbps | `2.5GE1` | 2.5GBASE-T，需 NBASE-T 支持 |
| `eth5g` | 5000 Mbps | `5GE1` | 5GBASE-T，对线缆更敏感 |
| `eth10g` | 10000 Mbps | `10GE1` / `SFP+1` | 10GBASE-T 或 SFP+ 光口 |
| `eth25g` | 25000 Mbps | `SFP28-1` | 25G，机房上联常见 |
| `pon10g` | 10000 Mbps | `PON1` | 10G-EPON；上下行能力可能不对称 |
| `wifi` | 0（协商） | `WLAN` | 实际速率由 802.11 标准协商，不由端口标称 |

**WiFi 标称速率表**（单流近似，用于协商上限）：

| 标准 | 2.4 GHz | 5 GHz | 6 GHz |
|---|---|---|---|
| 802.11n | 150 | 300 | — |
| 802.11ac | — | 866 | — |
| 802.11ax | 287 | 1201 | 1201 |
| 802.11be | — | 2882 | 2882 |

无线链路协商 = `min(两端标称)`；**有效吞吐**还要再打折（半双工 + 共享介质），
折扣在 `FR-19 通讯速度` 里体现，而不是把链路速率改小——"协商速率"与"能用多少"
是两个不同的数字，混在一起会让用户看不懂。

## 3. 线缆目录与物理约束（本产品的差异化所在）

| 类型 | 标准名 | 用户俗称 | 配对端口 | 长度上限 | 速率分档 |
|---|---|---|---|---|---|
| `cat5` | TIA/EIA-568-A Cat5 | CAT5 | RJ45 | 100 m | ≤100 m → 100M |
| `cat5e` | TIA/EIA-568-B Cat5e | CAT5e / 超五类 | RJ45 | 100 m | ≤100 m → 2.5G |
| `cat6` | TIA/EIA-568-C.2 Cat6 | CAT6 / 六类 | RJ45 | 100 m | ≤55 m → 10G；≤100 m → 2.5G |
| `cat6a` | TIA/EIA-568-C.2 Cat6a | **CAT6e**（非标准） / 超六类 | RJ45 | 100 m | ≤100 m → 10G |
| `lc-om3` | ISO/IEC 11801 OM3 | 万兆多模 | SFP | 300 m | ≤100 m → 40G；≤300 m → 10G |
| `lc-om4` | ISO/IEC 11801 OM4 | 万兆多模（增强） | SFP | 550 m | ≤150 m → 40G；≤550 m → 10G |
| `lc-sm` | OS2 单模 | 单模光纤 | SFP | 10 km | ≤10 km → 100G |
| `dac` | SFF-8431 高速铜缆 | DAC 堆叠线 | SFP | 5 m | ≤5 m → 25G |
| `wireless` | IEEE 802.11 | 无线 | WiFi | — | 按标准协商 |

### 必须实现的五条硬约束

1. **电口与光口不能直连**：`rj45 ↔ sfp` 判为介质不匹配，链路 down，提示需光模块/介质转换器。
2. **铜缆 > 100 m 直接不通**（不是降速）。这是最容易被忽略、也最有教学价值的判定。
3. **CAT6 的 10G 只有 55 m**（永久链路约 37 m）；80 m 的 CAT6 连两个 10G 口 → 实际 2.5G。
4. **CAT6e 不是标准名**，标准名是 CAT6a；UI 显示为 `CAT6a（俗称 CAT6e）`，
   并在用户选择 CAT6e 时给出说明，避免用户按错误名称采购或建模。
5. **光纤速率由光模块决定**：SFP 1G 口插在 OM4 线缆上仍是 1G；
   反之 SFP+ 10G 口接 OM3 超过 300 m 也无法协商到 10G。

### 为什么"降速"与"不通"要分开

- **不通**（介质不匹配、超长）→ 链路 `down`，没有任何流量。
- **降速**（线缆能力低于端口能力）→ 链路 `up`，但速率取三者最小值，并**在证据链里提示原因**。

用户最常见的误判是把"降速"当成"不通"，或把"超长"当成"慢"。
产品把两者区分清楚，本身就是价值。

## 4. 设备目录

| key | 名称 | kind / subtype | 默认端口 | 三层能力 | 默认服务 |
|---|---|---|---|---|---|
| `ont` | 光猫（路由模式） | `ont` | PON1（10G-EPON）+ GE1–GE4（1G RJ45，LAN）+ WLAN | ✅ | NAT ✅ / DHCP ✅ / DNS 转发 ✅ |
| `ont-bridge` | 光猫（桥接模式） | `ont` | 同上 | ✅ | 全部关闭（透传） |
| `olt` | OLT 局端 | `olt` | PON1–PON4（10G）+ SFP1（10G 上联） | ✅ | — |
| `cloud` | 云 / 互联网出口 | `cloud` | SFP1（10G） | ✅ | DNS 权威 ✅ |
| `router` | 路由器 | `router` | GE1（WAN 1G）+ GE2–GE4（LAN 1G）+ SFP+1（10G）+ WLAN | ✅ | NAT ✅ / DHCP ✅ |
| `switch-5-2.5g` | 交换机（5 口 2.5G） | `switch` | GE1–GE5（2.5G）+ SFP+1、SFP+2（10G） | ✗ | — |
| `switch-8-1g` | 交换机（8 口千兆） | `switch` | GE1–GE8（1G） | ✗ | — |
| `switch-24-1g` | 交换机（24 口千兆 + 2×SFP+） | `switch` | GE1–GE24（1G）+ SFP+1、SFP+2（10G） | ✗ | — |
| `ap` | 无线 AP | `ap` | GE1（2.5G 上联）+ WLAN（802.11ax，全向 30 m） | ✗ | — |
| `bs-4g` | 4G 基站（LTE） | `base-station` / `bs-4g` | SFP+1、SFP+2（10G 回传）+ GE1（1G 回传/管理）+ WLAN（LTE，全向 150 m） | ✗ | — |
| `bs-5g` | 5G 基站（NR） | `base-station` / `bs-5g` | SFP+1、SFP+2（25G 回传）+ GE1（1G 回传/管理）+ WLAN（NR，全向 150 m） | ✗ | — |
| `cpe-5g` | 5G CPE（无线宽带） | `router` | GE1–GE3（1G LAN）+ 5G NR 无线口（关联基站） | ✅ | NAT ✅ / DHCP ✅ |
| `pc-desktop` | 台式机 | `computer` / `desktop` | GE1（1G） | ✗ | — |
| `pc-laptop` | 笔记本 | `computer` / `laptop` | GE1（1G）+ WLAN（ax） | ✗ | — |
| `pc-tablet` | 平板（计算机类） | `computer` / `tablet` | WLAN（ax） | ✗ | — |
| `server-rack` | 机架式服务器 | `computer` / `rack-server` | GE1、GE2（1G）+ SFP+1、SFP+2（10G） | ✗ | DHCP 服务端可选 |
| `workstation-tower` | 塔式工作站 | `computer` / `tower-workstation` | GE1、GE2（1G） | ✗ | — |
| `pc-mini` | 迷你主机 | `computer` / `mini-pc` | 2.5GE1（2.5G） | ✗ | — |
| `mobile-phone` | 手机 | `mobile` / `phone` | WLAN（ax） | ✗ | — |
| `mobile-tablet` | 平板（移动） | `mobile` / `tablet` | WLAN（ax） | ✗ | — |
| `nas` | NAS | `embedded` / `nas` | 2.5GE1（2.5G） | ✗ | DNS 服务端可选 |
| `camera` | 网络摄像头 | `embedded` / `camera` | FE1（100M）+ WLAN（n） | ✗ | — |
| `printer` | 网络打印机 | `embedded` / `printer` | GE1（1G）+ WLAN（n） | ✗ | — |
| `iot` | IoT 传感器 | `embedded` / `iot` | WLAN（n） | ✗ | — |
| `raspberrypi` | 树莓派 | `embedded` / `single-board` | GE1（1G）+ WLAN（ac） | ✗ | — |

**无线覆盖的缺省值**（`DEFAULT_COVERAGE_RADIUS_M`，D-56）：
家用网关（`ont` / `router`）40 m、无线 AP 30 m、蜂窝基站 150 m，形状都是全向。
这些是行业常识量级（吸顶 AP 的典型覆盖、城区微站口径），不是天线仿真；
要更远就在覆盖面板里调大，或者改成定向把功率集中到一个方向。
定向扇形的三扇区站用**三台基站**表达（分别转 0°/120°/240°）——
一台设备一个覆盖区域，不引入"一台设备多个扇区"的复合对象。

**关于"计算机"与"可移动设备"的分类**：按用户给定清单，`computer` 与 `mobile` 是两个 kind，
即使"平板"同时出现在两处——这是**用户的心智模型**（固定办公设备 vs 随身携带设备），
不是技术分类。目录里以 `computer/tablet` 与 `mobile/tablet` 区分，UI 分组也据此展示。

**我们额外增加的三类设备**（用户清单未列，但缺了它们无法完成用户要求的推演）：

- `ap`：没有 AP，"1Gbps WiFi / 2.5Gbps WiFi" 这类接口与无线链路就无处挂载；
- `olt` + `cloud`：用户明确要求 PON 与 10G-EPON，而 PON 是**点到多点**接入网，
  没有局端设备，光猫的 PON 口就是悬空的。
