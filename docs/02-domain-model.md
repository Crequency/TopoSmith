# 领域模型与数据 Schema

> 版本：v0.1（M0） ｜ 权威定义在 `packages/schema/src/index.ts`，本文档说明设计意图

## 1. 实体关系总览

```
Scenario ─┬─ Device ─┬─ Port ────┐
          │          ├─ L3Interface
          │          └─ services{dhcp,dns,nat}
          └─ Cable ──┴─ Endpoint{deviceId, portId}

派生（不入库，每次推演重算）：
  Cable + 两端 Port  ──►  Link{协商速率, 双工, up, issues}
  Scenario + Link    ──►  World{地址分配, 广播域, 路由表}
```

**核心原则：用户只编辑"事实"，不编辑"结果"。**

- 用户编辑：线缆类型与长度、端口速率与介质、VLAN、IP、服务开关。
- 系统派生：链路是否 up、协商到多少速率、设备拿到什么地址、报文走哪条路。

这条边界必须守住。一旦允许用户手填"这条链路是 1G"，物理约束模型立刻失效，
"为什么只能跑 2.5G"的解释也就无从谈起——而那正是本产品的价值。

## 2. 实体定义

### 2.1 Device

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定 ID（`dev-1` 形式，导入时重映射） |
| `kind` | DeviceKind | `ont`/`router`/`switch`/`computer`/`mobile`/`embedded`/`ap`/`olt`/`cloud` |
| `subtype` | string? | 计算机/可移动/嵌入式的细分（`desktop`/`rack-server`/`phone`/`nas`…） |
| `name` | string | 显示名，如「客厅光猫」 |
| `model` | string? | 型号文本，仅展示 |
| `x`, `y` | number | 画布世界坐标（不做自动布局，避免用户布局被覆盖） |
| `ports` | Port[] | 端口列表 |
| `l3` | {interfaces, staticRoutes, defaultGateway} | 三层配置 |
| `services` | {dhcp?, dns?, nat?} | 服务能力 |
| `client` | ClientAddressing? | 终端类设备的地址获取方式 |
| `wireless` | WirelessRadio? | AP/STA 无线配置 |
| `accessMode` | `'bridge'|'route'`? | 仅光猫/路由器：决定 NAT 与 DHCP 归属 |

**设备的行为由 `kind` 决定的三件事刻画**：

| kind | 是否二层转发 | 是否三层转发 | 备注 |
|---|---|---|---|
| `switch` | ✅ | ✗（M0 不建模 L3 交换机） | 广播域的传播者 |
| `ap` | ✅（无线↔有线桥接） | ✗ | 无线客户端与 LAN 口同域 |
| `router` / `ont` / `olt` / `cloud` | ✗ | ✅ | **终结广播域** |
| `computer` / `mobile` / `embedded` | ✗ | ✗ | 端点，只收发 |

这张表是 L2 广播域算法的唯一依据（见 `05-engine.md`）。

### 2.2 Port

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 端口 ID |
| `name` | string | `GE1` / `Gi1/0/1` / `SFP+1` / `PON1` / `WLAN` |
| `medium` | `'rj45'|'sfp'|'pon'|'wifi'` | 介质类型，决定可与什么线缆配对 |
| `speedMbps` | number | 标称速率；WiFi 口为 0（实际速率由无线协商得出） |
| `duplex` | `'full'|'half'` | 双工 |
| `role` | `'lan'|'wan'|'access'|'trunk'|'uplink'|'client'` | 角色，影响默认 VLAN 与 UI 分组 |
| `vlan` | number? | access 口 PVID（默认 1） |
| `allowedVlans` | number[]? | trunk 口允许列表 |
| `module` | string? | SFP 模块描述（`SFP+ 10G`） |

**端口承载 VLAN 的判定**（`portCarriesVlan`）：

```
role === 'trunk'  →  allowedVlans.includes(vlan)
其他              →  (vlan ?? 1) === vlan
```

### 2.3 Cable

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 线缆 ID |
| `type` | CableType | `cat5`/`cat5e`/`cat6`/`cat6a`/`lc-om3`/`lc-om4`/`lc-sm`/`dac`/`wireless` |
| `lengthM` | number | 长度（米）；无线为 0 |
| `a`, `b` | Endpoint | 两端 `{deviceId, portId}` |
| `labelRatio?` | number | 速率标签在连线上的**弧长比例**（0 = A 端，1 = B 端，缺省 0.5）。**纯展示字段**，不参与推演（FR-46 / D-36） |
| `bonded?` | boolean | 是否属于「与对端之间的**链路聚合组**」（LACP / 静态聚合）。没有组 id：同一对设备之间所有 `bonded` 的线缆即同一组，多条时在推演中视为**一条逻辑链路**（因此不成环）。**参与推演**（FR-66 / D-50） |

### 2.4 地址模型

`Address` 是**派生实体**，来源有三：

1. 设备 `l3.interfaces[]`（基础设施，静态配置）；
2. 终端 `client.mode === 'static'` → `client.ip`；
3. 终端 `client.mode === 'dhcp'` → **DHCP 推演结果**（含成功/失败）。

```
Address {
  ip, prefix, gateway?, dns[], portId,
  source: 'static' | 'dhcp',
  lease?: { serverId, pool, index } | { failure: ReasonCode }
}
```

把 DHCP 结果并入地址模型，使上层（路由、诊断、DNS）无需关心地址来源——
`ARP` 与"本机地址判定"都只看 `Address` 列表。

### 2.5 DNS 模型

```
DnsServerConfig { enabled, records[{name, ip}], forwarders[] }
ClientAddressing { ..., dns[] }
```

解析顺序（见 `05-engine.md` §6）：**静态记录 → 转发器（递归，带访问集防环）→ NXDOMAIN**。
缓存不进 Schema（它不是拓扑事实），由调用方（UI 会话）持有，见 `07-diagnostics.md` §5。

## 3. Scenario 与版本

```ts
interface Scenario {
  schemaVersion: 1
  id, name, description?
  devices: Device[]
  cables: Cable[]
  updatedAt: string   // ISO
}
```

**版本策略**：`schemaVersion` 是整数，只在**破坏性变更**时递增；
导入时 `migrate(scenario)` 逐级升级（M0 只有 v1）。兼容性规则：

- 新增可选字段 → 不升版本；
- 重命名/删除字段、改变字段语义 → 升版本 + 写迁移函数 + 补迁移测试。

## 4. 不变量（引擎可依赖的假设）

1. `Cable.a/b` 指向存在的 `device.ports` 条目；一个端口**最多一根线缆**（M0 不支持堆叠/聚合）。
2. `Device.ports[].id` 在设备内唯一；`Device.id` 场景内唯一。
3. 无线线缆两端必须都是 `medium === 'wifi'` 的端口；非无线线缆两端不能是 wifi 口。
4. 端口速率必须是目录中登记的合法值（UI 用下拉，导入时校验）。
5. `l3.interfaces[].portId` 必须存在于该设备端口列表。
6. 拓扑允许孤岛（不连通的部分），诊断时以"不可达"结论呈现，而不是报错。

导入校验（`packages/schema/src/validate.ts`）负责 1–6 的机械部分并返回人类可读错误列表。
M1 起用 zod 重写该模块，保持相同的错误文本契约。
