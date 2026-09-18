<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-on-dark.svg">
    <img src="assets/brand/logo-on-light.svg" alt="TopoSmith — 拓扑匠" width="380">
  </picture>
</p>

<p align="center">
  <b>浏览器内的网络拓扑绘制与连通性推演器</b><br>
  <sub>手动画拓扑 → 精细标注端口速率与线缆类型 → 让工具回答<b>通不通、走哪条路、能跑多快、域名怎么解析过去</b>，并给出<b>为什么</b>。</sub>
</p>

<p align="center">
  <b>在线试用</b> → <a href="https://crequency.github.io/TopoSmith/">https://crequency.github.io/TopoSmith/</a>
  <sub>（纯静态站点，由 GitHub Pages 托管；打开即用，数据只存在浏览器本地）</sub>
</p>

<p align="center">
  <a href="https://github.com/Crequency/TopoSmith/actions/workflows/ci.yml"><img src="https://github.com/Crequency/TopoSmith/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/tests-45%20engine%20%C2%B7%20221%20web-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/build-482%20kB%20%C2%B7%20149%20kB%20gzip-blue" alt="Build size">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/backend-none-8b5cf6" alt="No backend">
  <img src="https://img.shields.io/badge/status-M0-orange" alt="Status: M0">
</p>

<p align="center">
  <img src="docs/assets/screenshot-office.png" alt="TopoSmith 界面：小微企业办公网预置场景，正在推演一台设计工作站到业务服务器的可达性" width="100%">
  <br>
  <sub>预置场景「小微企业办公网」：三个 VLAN 分段 + 机柜上架；图中正在推演 <b>设计工作站 → 业务服务器</b> 的跨 VLAN 可达性（3 跳可达，瓶颈 1 Gbps）。</sub>
</p>

## 这是什么

TopoSmith 不是逐包网络仿真器，而是**确定性推演器**：从拓扑与配置出发，用图算法 + 约束求解
算出路径、可达性、带宽与 DNS 解析链，并输出完整**证据链** —— 不只回答"通不通"，还回答"为什么"。

- ✅ 纯前端、零后端，构建产物是纯静态文件
- ✅ 线缆类型/长度与端口介质/速率**参与计算**，不是装饰字段
- ✅ 结果确定可复现：同输入同输出，推演内核里没有随机数与时钟
- ❌ 不做逐包仿真、不跑真实设备镜像、不提供 CLI —— 理由见 [`docs/00-overview.md`](docs/00-overview.md) §2/§5

## 功能

**绘制与编辑**
- 设备目录拖放；端口**画在设备面板上**（网口 / 光口 / PON / 天线按介质绘制），点端口即编辑详情
- **端口之间直接拖拽连线**（也可以照旧"点两次"；两条路径共用同一套校验与提示）
- **端口到端口的电缆曲线**：连线从端口出发，线缆类型与长度参与协商
- 端口可增删；卡片宽度可调；**机柜容器**（8–48U 上架下架、翻转看背面、悬浮透视）
- **链路聚合**：同一对设备之间的并联线缆可标为 LACP 聚合组 ——「双上行冗余」与「插了两根线的环路」从此是两件事
- **无线覆盖**：AP / 家用网关 / 蜂窝基站画出自己的覆盖区域（**全向圆**或**定向扇形**，半径以米计、可拖可填），
  无线关联不画成连线 —— 覆盖圈说明「能服务到哪」，信号波动画说明「这条关联此刻是通的」；
  设备被拖出覆盖圈（或不在扇区朝向内）时关联当场断开，并说明还差几米（[D-57](docs/DECISIONS.md)）
- 框选与 Ctrl/Shift 多选；六向对齐 + 两轴等距分布；网格与节点吸附（带引导线）
- 撤销重做（含拖动事务合并）、导入导出、节点树（搜索 / 排序 / 双击定位）
- **侧栏页面可排版**：左侧栏用页签切换「设备目录 / 节点树」，右侧栏把「检查器 / 诊断」上下堆叠、高度可拖；页面可拖到另一侧栏，两侧侧栏宽度可拖（都会记住）
- **命令菜单** `Ctrl/Cmd+Shift+P`：VSCode 习惯的面板（搜索 / 分组 / 键盘导航）；当前只有界面，命令尚未接入

**推演与诊断（四类，全部带证据链）**
- **可达性**：能不能通，不通卡在哪一跳、原因码是什么
- **数据包链路**：逐跳列出设备、端口、链路速率、VLAN 与地址
- **通讯速度**：端到端瓶颈在哪一段、单向时延、单流有效吞吐
- **DNS 解析路径**：域名 → 哪台服务器 → 缓存命中 / 转发 / NXDOMAIN
- **二层环路 / 广播风暴**：成环时点名**闭合的环路径**，说明广播帧为什么不会自己消失，并声明哪些结论因此不可信

**可视化**
- 诊断后播放**流向动画**：粒子速度按链路速率对数映射、逐跳停顿、失败停在阻断点并红脉冲
- 连线与速率标签按带宽着色（**1G 红 → 10G 绿**，对数均匀分配，右上角图例）
- 拖设备时**连线有平面物理摆动**（位移冲量 + 弹簧回零），快甩甩得远、松手回摆几下
- 无线关联用**信号波**表示连通（信号点沿关联流动 + 两端涟漪），画在独立覆盖层上、按需启停，并尊重系统的「降低动效」偏好
- 适应视图按真实画布尺寸把「设备 ∪ 连线」完整装入；缩放 5%–400%；低缩放自动分级绘制
- **右键任意一点 → 测量此点的无线信号**：能收到哪些信号、各自信道与质量（距离/余量/档位）、
  **自由空间估算电平（dBm）**、标称与估算速率，以及按频段聚合的**信道情况**
  （同频干扰 / 2.4G 邻频重叠）；口径与简化在面板里如实写明
- **信道重叠图**：2.4G 按"一个信道 ≈ 22 MHz ＝ 5 个信道号宽"画出重叠曲线（1/6/11 为什么互不重叠，
  看图即得），5G/6G 信道正交则画占用条并标出同频
- 配置 SSID / PLMN 时**可以从这台设备能收到的信号里直接选**（带质量、频段、信道提示；
  选 SSID 时频段一起同步）

## 快速开始

需要 Node ≥ 20 与 pnpm 11。

```bash
pnpm install
pnpm dev          # 开发服务器 http://127.0.0.1:31006
pnpm check        # 类型检查 + 两套单测
pnpm build        # 生产构建到 apps/web/dist
pnpm preview      # 预览构建产物
```

`pnpm screenshot` / `pnpm brand`（重新生成 README 主图与 favicon）需要 Playwright 的 Chromium。
开发环境、命令清单、代码约定与提交习惯见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 部署

产物是纯静态文件，丢到任意静态服务器即可（**挂到子路径时必须带基路径**，否则白屏）：

```bash
BASE_PATH=/TopoSmith/ pnpm build                   # 子路径构建
docker build -t toposmith . && docker run --rm -p 41006:41006 toposmith
```

容器端口、compose 用法、缓存策略与容器里踩过的坑：见 [`docs/09-deployment.md`](docs/09-deployment.md)。

## 预置场景

工具栏「预置场景」打开选择弹窗，八套开箱可用、且**各自演示一类能力**的拓扑：

| 场景 | 规模 | 演示什么 | 有意留的坑 |
|---|---|---|---|
| 家庭网络 | 10 台 · 9 线 | 光猫路由模式做 NAT/DHCP、AP 无线、PON 接入、DNS 转发链 | — |
| **小微企业办公网** | 15 台 · 15 线 | VLAN 分段（办公/访客/服务器）、跨 VLAN 路由、机柜上架 | 访客段上联口忘打标，ping 摄像机会报「两端不在同一广播域」并指名两个端口 |
| 机房机柜 | 12 台 · 12 线 | 42U 机柜与多 U 上架、背面端口透视、万兆 DAC、瓶颈定位 | — |
| 光接入 | 10 台 · 9 线 | 同一 OLT 两户：**桥接光猫 + 自备路由** vs 路由光猫一台搞定 | B 户老光猫是 EPON 1G，那条 PON 按 1G 协商 |
| 园区无线 | 13 台 · 12 线 | 三台 AP 同 SSID、2.4G/5G/6G 速率按两端取小、无线共享介质 | 一台平板配错 SSID，链路起不来并报 SSID 不一致 |
| **网络环路与广播风暴** | 17 台 · 20 线 | 三处典型成环（双上行没做聚合 / 跳线插回自己 / 无线中继接回有线）+ 用另一个 VLAN 当对照组 | 三处环都能修：标成链路聚合或拆掉冗余线、拔掉自环跳线、撤掉无线中继 |
| **蜂窝网络** | 16 台 · 15 线 | 4G/5G 基站与**定向扇形覆盖**、覆盖即关联判定、5G CPE 无线宽带（FWA） | 一台手机落在扇区背面、一台平板跑出覆盖圈、一台只有 WiFi 的笔记本接在基站上 —— 三条关联全断，且原因各不相同 |
| 中型托管 IDC | **810 台 · 809 线** | 3 机房 × 24 柜 × 42U 满配、双千兆 LACP 聚合上联 → 汇聚 → 万兆核心 → 出口；兼作规模压测 | — |

每套场景都是自洽的地址规划，并被单测逐条验证「说明里承诺的行为真的成立」，包括"把坑修好后恢复连通"。

画布上的右键由应用自己接管（输入框除外，保留粘贴），不会弹出浏览器原生菜单。

## 推演内核：Anvil

界面之下是一个独立、确定性的推演内核 —— **Anvil**（铁砧）：同一份拓扑与配置，永远得到同一个结论。
它**不是逐包仿真器**，不发一个包、不跑设备镜像，而是用图算法与约束求解算出结论并给出证据链。

|  |  |
|---|---|
| 包名 | `@toposmith/anvil`（源码在 `packages/engine/`） |
| 依赖方向 | `apps/web → @toposmith/anvil → @toposmith/catalog → @toposmith/schema`，反向零依赖 |
| 运行环境 | 纯 TypeScript：零 DOM、零 React、零浏览器 API，单测直接在 Node 下跑 |
| 负责 | 链路协商、广播域（VLAN）、路由与 NAT、DHCP 租约、DNS 解析链、二层环路检测、四类诊断 |
| 不负责 | 像素、相机、事件、存储 —— 画布连"能不能连这条线"都要问它（`negotiateLink`） |

```ts
import { buildWorld, ping } from '@toposmith/anvil';

const world = buildWorld(scenario);            // 纯数据进：派生世界（链路协商 / 地址 / 租约 / 环路）
const result = ping(world, 'dev-pc', '203.0.113.10');

result.ok;                                     // 能不能通
result.steps.map((step) => step.code);         // ['SRC_ADDRESS', 'ROUTE_MATCH', 'ARP_OK', 'REACHED']
```

设计细节见 [`docs/05-engine.md`](docs/05-engine.md)，命名与边界的取舍见 [`docs/DECISIONS.md`](docs/DECISIONS.md) D-54。

## 项目结构

```
toposmith/
├─ docs/                需求 / 领域模型 / 目录 / 架构 / 内核 / 诊断 / 部署 / 路线图 / 决策记录
├─ packages/
│  ├─ schema/           类型定义 + 导入校验（输入契约）
│  ├─ catalog/          设备 / 端口 / 线缆 / 速率目录（纯数据）
│  └─ engine/           推演内核 Anvil（纯 TS，零 DOM/React，可在 Node 下直接测试）
├─ apps/web/            React 19 + Vite 8 + Tailwind 4 + zustand（样式全部内联类名）
├─ Dockerfile + Caddyfile + docker-compose.yml    容器形态（见 docs/09）
└─ scripts/            品牌产物与截图脚本
```

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/00-overview.md`](docs/00-overview.md) | 定位、核心判断（推演 ≠ 仿真）、非目标、术语 |
| [`docs/01-requirements.md`](docs/01-requirements.md) | 全量需求与逐条验收标准、NFR、已知不做 |
| [`docs/02-domain-model.md`](docs/02-domain-model.md) | 领域模型、数据 Schema、不变量 |
| [`docs/03-catalog.md`](docs/03-catalog.md) | 设备/端口/线缆目录与五条物理硬约束 |
| [`docs/04-architecture.md`](docs/04-architecture.md) | 分层、包边界、渲染方案、状态管理 |
| [`docs/05-engine.md`](docs/05-engine.md) | 链路协商、广播域、路由、逐跳推演、带宽、DNS、环路 |
| [`docs/06-addressing.md`](docs/06-addressing.md) | IP / 网段 / VLAN / DHCP / DNS 模型 |
| [`docs/07-diagnostics.md`](docs/07-diagnostics.md) | 诊断输出契约、原因码表、证据链呈现规范 |
| [`docs/08-roadmap.md`](docs/08-roadmap.md) | 里程碑、逐轮实测数据、已知缺口 |
| [`docs/09-deployment.md`](docs/09-deployment.md) | 静态托管与基路径、Pages、容器镜像、端口、镜像仓库 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 决策记录（含「为什么没选另一条路」与代价） |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 环境、命令、代码约定、提交与文档习惯 |

## 质量

- **单测在仓库里**：引擎 54 项（Node，无 jsdom）、前端 244 项（几何 / 覆盖交互 / 端口布局 / 侧栏布局 /
  命令菜单 / store 行为 / 八套预置场景的行为承诺）；`pnpm check` 一次跑完；
- **端到端与规模压测**用真实 Chromium 驱动，覆盖画布交互、四类诊断、侧栏排版与性能预算，
  实测数据记在 [`docs/08-roadmap.md`](docs/08-roadmap.md)（810 台设备场景：拖动中位帧 33 ms）；
- **已知缺口**（节点树无虚拟滚动、拖动态每帧重建世界等）同样记在路线图的"已知不足"里 ——
  不藏在代码注释里。

## 参与开发

欢迎 issue 与 PR。请先读 [`CONTRIBUTING.md`](CONTRIBUTING.md)：环境与命令、代码约定、
以及这个仓库"新能力要带需求条目 + 决策记录 + 单测"的惯例。

## 第三方资源与许可

| 资源 | 许可 | 用途 |
|---|---|---|
| [Lucide](https://lucide.dev) | **ISC**（商用免费，无需 UI 署名） | 设备/端口/界面图标；画布 `Path2D` 与 SVG 组件共用同一份数据 |

项目不包含任何厂商设备镜像、商标素材或私有配置文件；目录中的设备与线缆参数均为公开标准
（TIA/EIA、IEEE 802.3/802.11、ISO/IEC 11801）的数值事实。

## 许可

[MIT](LICENSE) © 2026 Dynesshely
