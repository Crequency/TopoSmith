# 技术架构

> 版本：v0.1（M0） ｜ 与代码目录一一对应

## 1. 分层

```
┌──────────────────────────────────────────────────────────┐
│ apps/web        画布交互 / 面板 / 诊断 UI（React + Tailwind）│
├──────────────────────────────────────────────────────────┤
│ packages/engine 推演内核 **Anvil**（`@toposmith/anvil`）    │
│                 纯 TS，零 DOM / 零 React 依赖               │
│   ├ l2/         广播域、VLAN、ARP 解析                      │
│   ├ l3/         路由表、最长前缀匹配、NAT 判定               │
│   └ diag/       四类诊断编排 + 证据链 + 原因码               │
├──────────────────────────────────────────────────────────┤
│ packages/catalog 设备/端口/线缆/速率目录（纯数据 + 纯函数）   │
├──────────────────────────────────────────────────────────┤
│ packages/schema  类型定义 + 导入校验（引擎的输入契约）        │
└──────────────────────────────────────────────────────────┘
```

**依赖方向严格单向**：`apps/web → @toposmith/anvil（engine）→ @toposmith/catalog → @toposmith/schema`。
引擎不认识 React，也不认识 Canvas——它只吃 `Scenario`、吐 `DiagResult`。
这条纪律换来三件东西：NFR-08（可在 Node 下测）、NFR-03（确定性可回归）、
以及将来把引擎搬到 Worker 或后端时的零改动。

## 2. 为什么是这几个包（以及为什么不是更多）

上一版规划里 `l2` / `l3` / `dns` / `wireless` / `diag` 各是一个独立包，
M0 落地时**合并进 `engine`（包名 `@toposmith/anvil`）的子目录**。理由是具体的：

- 它们**共享同一个 `World` 类型**，且互相调用（诊断要同时用 l2 和 l3）。
  拆成独立包只会带来循环依赖或一个额外的 `types` 包，收益为零。
- 它们**没有独立消费者**：没有任何一方只需要 l3 而不需要 l2。
- 包边界一旦立起来就有人依赖，将来拆不动。现在合并，等真的出现第二个消费者
  （比如"只做 DNS 教学"的独立应用）再拆，成本更低。

`catalog` 与 `schema` 保持独立，因为它们有明确的独立价值：
catalog 是纯数据（可被文档生成、采购清单等复用），schema 是输入契约（导入导出的边界）。

## 3. 渲染方案：M0 用 Canvas 2D，WebGL 是 M2 的优化项

| 方案 | 适用规模 | M0 决策 |
|---|---|---|
| DOM / SVG | < 1–2k 元素 | ✗ 端口级连线交互会成为瓶颈 |
| **Canvas 2D（本期）** | ~300–500 节点舒适 | ✅ |
| WebGL（PixiJS / 自研） | 10⁵ 顶点级 | M2 达标后再切 |

**为什么先不上 WebGL**：M0 的目标是"把推演链路打通"，而不是"渲染压测"。
渲染器已经抽象为 `render/draw.ts` + `render/Canvas.tsx` 两层，
绘制原语（节点、端口、线缆、文本）与视口变换（`world ↔ screen`）是纯函数，
换成 PixiJS 只需重写 `draw.ts`，交互与状态层不动。

**切换的硬门槛（NFR-01）**：若实测 300 节点 / 500 链路低于 50fps，
或 1000 节点出现明显卡顿，M2 必须切 WebGL，不得靠"用户少放点设备"绕过。

## 4. 状态管理

单一 `zustand` store（`apps/web/src/state/store.ts`），持有：

- `scenario`：唯一事实源（拓扑）；
- `world`：**派生**，`scenario` 变更后同步重算（`buildWorld`，M0 规模下 < 1ms）；
- `viewport` / `selection` / `linkDraft`：纯 UI 状态；
- `diag`：诊断输入与结果、DNS 会话缓存；
- `uiLayout`（侧栏卡片的顺序 / 折叠 / 权重 / 侧栏宽度）+ `draggingCard` / `cardDropTarget`
  （拖拽现场）+ `paletteOpen`（命令菜单）：界面偏好与瞬时状态（FR-69～71）。

**界面偏好与拓扑分开落盘**：`toposmith.ui.layout.v1` 存布局，`toposmith.scenario.v1` 存拓扑。
换场景、清空拓扑不该重置布局；导出/导入拓扑也不该把别人的界面偏好带过去。
拖拽现场状态（`draggingCard`）不进持久化，也不进撤销栈 —— 它不是"用户改了什么"。

**派生世界不进持久化**。序列化只写 `scenario`，`world` 每次加载重算——
这样"结果永远与事实一致"，不存在把过期推演结果存进文件的风险。

## 5. 画布与引擎的边界

画布**不做任何网络语义判断**。连线时它只做两件事：

1. 把两端 `{deviceId, portId}` 交给 `anvil.negotiateLink` 试探；
2. 若返回 `issues` 含 `error` 级 → 拒绝创建并弹出原因；否则创建线缆，由引擎重算链路。

于是"为什么不让我连"和"为什么这条链路只有 2.5G"用的是**同一套判定逻辑**，
不会出现"画布允许但推演认为不通"的矛盾。

## 6. 目录结构（与代码一致）

```
toposmith/
├─ docs/                     本文档集（10 份）
├─ packages/
│  ├─ schema/src/
│  │   ├─ index.ts           全部类型 + SCHEMA_VERSION
│  │   └─ validate.ts        导入校验，返回人类可读错误列表
│  ├─ catalog/src/
│  │   ├─ speeds.ts          速率常量、格式化、WiFi 标称速率表
│  │   ├─ cables.ts          线缆规格 + 速率分档 + 有效速率计算
│  │   ├─ ports.ts           端口工厂 + portCarriesVlan
│  │   └─ devices.ts         设备模板（含默认端口与服务）
│  └─ engine/src/           推演内核 Anvil（包名 @toposmith/anvil）
│      ├─ ip.ts              IPv4 解析/掩码/同网段/最长前缀
│      ├─ model.ts           buildWorld + negotiateLink + 派生链路
│      ├─ l2/domain.ts       VLAN 感知广播域 BFS + ARP 解析
│      ├─ l3/routing.ts      路由表构建 + 最长前缀查找 + NAT 判定
│      ├─ dhcp.ts            DHCP 租约推演（确定性）
│      ├─ dns.ts             解析链推演 + 会话缓存
│      ├─ diag/reasons.ts    原因码表（唯一文案来源）
│      ├─ diag/trace.ts      ping / 逐跳路径
│      ├─ diag/bandwidth.ts  瓶颈带宽与时延
│      └─ diag/index.ts      统一诊断入口
└─ apps/web/src/
    ├─ lib/icons.ts          Lucide 图标注册表：Path2D（画布）+ Icon 组件（DOM）同源
    ├─ lib/geometry.ts       对齐 / 分布 / 吸附 / 框选判定（纯函数，有单测）
    ├─ lib/polyline.ts       折线弧长参数化：按比例取点 / 光标投影回比例（纯函数，有单测）
    ├─ lib/ports.ts          端口图元布局：尺寸分档 + 自动换行 + 命中测试（纯函数，有单测）
    ├─ lib/flow.ts           流向动画模型：路径构建、速率映射、推进与阻断（纯函数，有单测）
    ├─ lib/history.ts        撤销/重做栈：合并窗口 + 拖动事务（纯函数，有单测）
    ├─ lib/speed-color.ts    速率 → 颜色映射（纯函数，有单测）
    ├─ lib/node-tree.ts      节点树派生：机柜父子分组 + 排序 + 过滤（纯函数，有单测）
    ├─ lib/panels.ts         侧栏页面布局：插入位 / 换位 / 宽度夹取 / 权重分配（纯函数，有单测）
    ├─ lib/command-menu.ts   命令菜单数据与过滤：分组、顺序、子串匹配（纯函数，有单测）
    ├─ lib/cable-physics.ts  连线摆动物理（纯函数，有单测）
    ├─ lib/number-input.ts   数字输入的提交语义：草稿 → 提交（纯函数，有单测）
    ├─ render/draw.ts        纯绘制函数（世界坐标 → 屏幕）+ 连线标签命中框
    ├─ render/Canvas.tsx     画布组件 + 指针交互 + 多选 + 吸附 + 动画循环
    ├─ components/           Toolbar / LeftPanel / RightSidebar / SidebarTabs（左栏页签）/
    │                        SidebarStack（右栏堆叠面板）/ sidebar-drop（跨栏落点判定）/
    │                        cards.tsx（页面 id → 内容的唯一登记表）/ Inspector / Diagnostics /
    │                        CommandPalette / Palette / NodeTree / 各弹窗
    ├─ scenarios/home.ts     预置家庭场景
    └─ state/store.ts        zustand store
```

## 7. 构建与工具链

| 项 | 选型 | 说明 |
|---|---|---|
| 包管理 | pnpm workspaces | 本机已有共享 store，避免重复下载 |
| 语言 | TypeScript（strict） | `verbatimModuleSyntax` + `noUnusedLocals` |
| 构建 / 开发服务器 | Vite 8 | 端口 31006，`host: 0.0.0.0`，`strictPort` |
| UI | React 19 | 无路由（单页工具） |
| 样式 | **Tailwind CSS 4（类名内联写法）** | 不写独立 `.css` 组件样式，样式一律在 `className` 里 |
| 状态 | zustand | 单一 store |
| 测试 | 引擎 + 前端纯函数单元测试（`pnpm test`） | 内核与画布几何/动画逻辑均为纯函数，Node 下可跑 |
| 图标 | **Lucide 1.46.0（ISC 许可，商用免费）** | 一份数据同时供 Canvas `Path2D` 与 SVG 组件使用（D-20） |

**Tailwind 使用约定（用户指定）**：
- 全部样式写在 `className` 上，**不新增**语义化 CSS 类；
- 需要复用的视觉片段抽成 React 组件，而不是 `@apply`；
- 允许的例外只有 `index.css` 里的 `@import "tailwindcss"` 与极少数全局基线样式。

## 8. 部署形态

`apps/web` 构建产物为纯静态文件（`dist/`），可放任意静态托管。
**零后端**不是权宜之计而是产品定位的一部分：可离线、可内网部署、可嵌入文档站、
没有服务器成本，也就没有"服务停了拓扑打不开"的风险。

将来若要做多人协作（FR-24 之外），后端只承担 CRDT 中继与对象存储，
推演仍在前端完成——**推演逻辑永远可以离线跑**。

## 9. 开发服务器与端口

| 项 | 值 |
|---|---|
| 监听 | `0.0.0.0:31006`（`strictPort: true`，不自动漂移） |
| 信任域名 | `toposmith.dev-u26-001.services.local` |
| 启动方式 | 必须经 DevHub：`devctl start toposmith dev`（禁止裸 `pnpm dev &`） |
| 端口来源 | 由项目自身 `vite.config.ts` 硬编码决定，DevHub 只登记不分配 |
