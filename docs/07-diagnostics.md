# 诊断输出契约与证据链

> 版本：v0.1（M0） ｜ 权威定义在 `packages/engine/src/diag/`

## 1. 统一输出契约

四类诊断返回同一个结构。**任何诊断都不允许只返回布尔值。**

```ts
interface DiagResult {
  kind: 'ping' | 'trace' | 'bandwidth' | 'dns'
  ok: boolean
  summary: string            // 一句话结论（可含数字）
  steps: DiagStep[]          // 证据链：按发生顺序
  hops: Hop[]                // 逐跳（dns 类为解析链）
  metrics?: BandwidthMetrics // 仅带宽类
  answer?: { ip?: string; name?: string }
}

interface DiagStep {
  code: ReasonCode           // 机器可读，测试断言用
  level: 'ok' | 'info' | 'warn' | 'error'
  title: string              // 短标题，UI 时间线用
  detail: string             // 人类可读展开说明
  deviceId?: string
  portId?: string
  data?: Record<string, unknown>  // 结构化附加信息（VLAN、前缀长度、速率…）
}

interface Hop {
  index: number
  deviceId: string; deviceName: string
  inPort?: string; outPort?: string
  linkSpeedMbps?: number; linkFamily?: 'copper' | 'fiber' | 'wireless'
  linkIssues?: string[]
  nextHopIp?: string
  /** 本跳在二层**实际经过**的链路 id（含中间交换机两侧），D-23 */
  transitLinkIds?: string[]
  nat?: string               // '192.168.1.101 → 100.64.0.10' 形式
  note?: string
}
```

**为什么单独抽出 `code`**：文案会改、会翻译（NFR-09），原因码不会。
单元测试断言 `steps.map(s => s.code)`，UI 断言渲染结果，两者解耦。

## 2. 四类诊断的用途与差异

| 诊断 | 回答的问题 | 关键输出 |
|---|---|---|
| `ping` 可达性 | 通不通？ | `ok` + 失败点原因码 + 精简证据链 |
| `trace` 数据包链路 | 走哪条路？ | 逐跳表：进出接口、速率、介质、NAT 点 |
| `bandwidth` 通讯速度 | 能跑多快？ | 瓶颈跳、RTT、有效吞吐、1 GiB 传输耗时 |
| `dns` 解析路径 | 域名怎么解析过去？ | 解析链 + 缓存命中/TTL + 权威来源 |

`ping` 与 `trace` 共用同一算法（`05-engine.md` §4），差异只在输出裁剪：
`ping` 在首个错误处停止并聚焦该错误；`trace` 保留全部已走过的跳。

**四类诊断都会带上"拓扑层"的告警**（§3.3）：源或目的所在广播域里存在二层环路时，
任何一类诊断都会先给出 `L2_LOOP` + `BROADCAST_STORM` 两步 `warn` ——
环路与查什么无关，它影响的是"这个结论在真机上还算不算数"。

## 3. 原因码表（M0 全部实现并有测试）

### 3.1 成功路径

| 码 | 级别 | 触发 |
|---|---|---|
| `OK` | ok | 到达目标 |
| `SRC_ADDRESS` | info | 源地址来源（静态 / DHCP 租约，含服务器） |
| `ROUTE_MATCH` | info | 命中的路由条目（含前缀长度与来源） |
| `DIRECT_DELIVERY` | info | 直连投递，无需网关 |
| `ARP_OK` | info | 下一跳 ARP 解析成功 |
| `REACHED` | ok | 目的设备确认收到 |
| `NAT_SNAT` | info | 记录 NAT 源地址转换点 |

### 3.2 失败路径（每个都有独立测试用例，对应 FR-17 验收）

| 码 | 级别 | 语义 | 典型场景 |
|---|---|---|---|
| `NO_SOURCE_ADDRESS` | error | 源设备无任何地址 | 终端未配置且未获取到 DHCP |
| `NO_DHCP_SERVER` | error | 广播域内无 DHCP 服务器 | 路由器关了 DHCP 服务 |
| `POOL_EXHAUSTED` | error | 地址池耗尽 | 池太小 |
| `NO_ROUTE` | error | 路由表无匹配条目 | 跨网段但无网关/无明细路由 |
| `NO_GATEWAY` | error | 需要网关但未配置 | 同上，特指终端缺默认网关 |
| `PORT_NOT_CONNECTED` | error | 出接口没有连线 | 网线没插 |
| `LINK_DOWN` | error | 链路不可用 | 线缆超长 / 介质不匹配 |
| `LINK_TOO_LONG` | error | 线缆超过该类别长度上限 | CAT6 拉 150 m |
| `MEDIUM_MISMATCH` | error | 端口介质与线缆类别不匹配 | RJ45 ↔ SFP、PON ↔ 双绞线 |
| `SSID_MISMATCH` | error | 无线两端 SSID 不一致 | STA 连不上 AP（大小写敏感） |
| `VLAN_MISMATCH` | error | 两端不在同一广播域 | access VLAN 不一致 / trunk 未放行 |
| `ARP_FAILED` | error | 域内无人持有该 IP | 目标未接入该 VLAN、网线插错 |
| `NAT_MISSING` | error | 私网访问公网但未开 NAT | 光猫桥接模式直连公网 |
| `ROUTING_LOOP` | error | 超过 TTL 上限 | 路由互相指回 |
| `DNS_UNREACHABLE` | error | 所选 DNS 服务器不可达 | 含子链说明不可达原因 |
| `NO_DNS_CONFIGURED` | error | 客户端没有 DNS 服务器 | 静态配置遗漏 |
| `NO_DNS_SERVICE` | error | 目标设备未启用 DNS 服务 | 指错了服务器 |
| `DNS_NXDOMAIN` | error | 域名不存在 | 静态记录与转发器都没结果 |
| `DNS_FORWARD_LOOP` | error | 转发器成环 | 两台 DNS 互相转发 |

**UI 契约**：`error` 级步骤必须以红色可展开条目呈现，且**默认展开第一条错误**。
用户不需要点开三层才看到原因——那是排障工具最忌讳的设计。

### 3.3 拓扑告警（warn，不阻断结论）

| 码 | 语义 | 典型场景 |
|---|---|---|
| `LINK_SPEED_LIMITED` | 链路降速（线缆能力限制） | CAT6 拉 60 m |
| `LINK_SPEED_NEGOTIATED` | 两端端口速率不同，按较低者协商 | 2.5G 口接千兆口 |
| `WIFI_SHARED_MEDIUM` | 无线是共享半双工介质 | 同一 AP 下多客户端 |
| `L2_LOOP` | 检测到二层环路（附**闭合的环路径**与波及范围） | 双上行没做聚合 / 跳线插回自己 / 无线中继接回有线 |
| `BROADCAST_STORM` | 广播风暴风险：以太网帧没有 TTL，广播帧沿环无限循环 | 同上的后果说明 + 已知简化披露 |
| `KNOWN_SIMPLIFICATION` | 已知简化披露 | 时延/吞吐的估算口径 |

**环路为什么是 `warn` 而不是 `error`**：可达性推演给出的"拓扑上可达"并没有错
（BFS 最短路确实存在），错的是**真机上还会同时发生风暴**。把它写成 `error`
等于替用户断言"一定不通"——而真机是否瘫痪取决于有没有 STP、风暴发展到哪一步，
这些本推演并不建模。所以做法是：结论保持 `ok`，但**强制在结论里带上环路**——
`ping` 的 summary 会追加"（注意：源所在广播域有 N 处二层环路，真机上会形成广播风暴）"，
`bandwidth` 的 summary 会追加"这两个数字是按「没有风暴」算出来的估计值"，
链路级另有 `L2_LOOP` 告警把环路径写在检查器里（FR-67）。

## 4. 证据链的呈现规范

1. **顺序即因果**：步骤按推演发生顺序排列，不允许事后重排（便于对照逐跳表）。
2. **每条都可展开**：默认显示 `title`，展开显示 `detail` 与结构化 `data`
   （VLAN 号、前缀长度、速率、端口名）。
3. **首错高亮**：第一条 `error` 默认展开，其余折叠。
4. **不隐瞒成功**：成功路径同样记录（`SRC_ADDRESS`、`ROUTE_MATCH`），
   因为用户常需要"通的时候它到底怎么走的"来学习。
5. **术语一致**：端口名、设备名一律取自场景，不用内部 ID 展示给用户。

## 5. DNS 会话缓存契约

```ts
type DnsSessionCache = Map<string /* `${serverId}|${name}` */, { ip: string; expiresAt: number }>
```

- 由 UI store 持有，作为参数传入 `resolve`；
- 命中 → 步骤 `DNS_CACHE_HIT`（含剩余 TTL）；
- 未命中 → 走完整解析链，步骤末尾写缓存；
- 用户可"清空 DNS 缓存"以重现冷启动路径（教学开关）。

## 6. 已知简化（必须在结论区披露）

诚实披露简化，比假装精确更有价值。M0 的简化项：

| 简化 | 影响 | 计划 |
|---|---|---|
| 不做回程对称推演（有 NAT 即视为可回程） | 无法发现非对称路由问题 | M3 视需求 |
| 二层路径按 BFS 最短路取一条（存在等价多路径时只展示其中一条） | 双上行冗余场景只显示单条路径；**已成环时会额外报 `L2_LOOP` + `BROADCAST_STORM`** | M3（配合聚合的带宽叠加） |
| 不做 ACL / 防火墙规则过滤 | 无法模拟"被策略挡住" | M2（FR 待编号） |
| 不做 STP（端口状态机 / 根桥选举） | 环路能否被阻塞、阻塞哪个口，本推演不回答；只要成环且没做聚合就按"会成风暴"报 | M2 |
| 无线不建模距离衰减与穿墙 | 无线速率只取决于标准与并发数 | M2（FR-10 验收项） |
| 分光比按在线用户数均分，不建模 DBA 调度 | PON 上行速率为近似值 | M2（FR-16） |
| 链路聚合只提供**拓扑语义**（`bonded`，多条并联线缆视为一条，不成环） | 聚合的**带宽叠加**不参与速率/瓶颈计算，速率仍按单根算；堆叠不支持 | M2（带宽叠加） |

每条简化都会在相关诊断的 `metrics` 或结论区以 `info` 级步骤披露，
**不做静默近似**。
