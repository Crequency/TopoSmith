<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-on-dark.svg">
    <img src="assets/brand/logo-on-light.svg" alt="TopoSmith — 拓扑匠" width="360">
  </picture>
</p>

<p align="center">
  <b>浏览器内的网络拓扑绘制与连通性推演器</b><br>
  <sub>手动画拓扑 → 精细标注端口速率与线缆类型 → 让工具回答<b>通不通、走哪条路、能跑多快、域名怎么解析过去</b>，并给出<b>为什么</b>。</sub>
</p>

## 这是什么

TopoSmith 不是逐包网络仿真器，而是**确定性推演器**：从拓扑与配置出发，用图算法 + 约束求解
算出路径、可达性、带宽与 DNS 解析链，并输出完整**证据链**。

- ✅ 纯前端、零后端、可静态托管
- ✅ 线缆类型/长度与端口介质/速率**参与计算**（不是装饰字段）
- ✅ 结果确定可复现（同输入同输出）
- ❌ 不做逐包仿真、不跑真实设备镜像、不提供 CLI（见 `docs/00-overview.md` §5）

## 快速开始

```bash
# ⚠️ 本机环境变量里的代理（192.168.1.161:40404）已失效，安装必须绕过它
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY pnpm install

pnpm typecheck    # 全量类型检查
pnpm test         # 引擎单元测试（31 项）
pnpm test:web     # 前端单元测试（几何/端口/折线/节点树/store 等 122 项）
pnpm build        # 构建静态产物到 apps/web/dist
pnpm brand        # 由 assets/brand 重新生成 favicon / PNG（改了标识才需要跑）
```

开发服务器**必须经 DevHub 启停**（禁止裸 `pnpm dev &`）：

```bash
~/.devhub/devctl start toposmith dev --wait-ready
~/.devhub/devctl logs toposmith dev --follow
~/.devhub/devctl stop toposmith dev
```

| 项 | 值 |
|---|---|
| 监听 | `0.0.0.0:31006`（`strictPort`，不漂移） |
| 信任域名 | `toposmith.dev-u26-001.services.local` |
| 访问 | `http://127.0.0.1:31006` 或 `http://toposmith.dev-u26-001.services.local:31006` |

## 本机环境注意事项（实测踩过的坑）

1. **会话里的代理是过期值**：本会话环境变量 `http_proxy/https_proxy` 指向
   `192.168.1.161:40404`（No route to host），但系统登录 shell 的配置
   `/etc/profile.d/proxy.sh` 写的是 **`10.0.30.81:40404`，实测可用**
   （访问 registry 返回 200）。两者不一致源于 2026-09-14 的一次代理迁移，
   `/etc` 下留有一批 `*.bak-pre-proxy-20260914` 备份可佐证。
   直连 registry 同样可用，因此上面的安装命令直接绕过代理；
   若将来需要走代理，请用 `http://10.0.30.81:40404`。
2. **pnpm 11 不再读取项目 `.npmrc`**：pnpm 配置写在 `pnpm-workspace.yaml`。
   其中的 `storeDir` 指向工作区内的 `.pnpm-shared-store` —— 因为默认 store 在会话工作区之外，
   被 DSH 文件沙箱置为只读，会报 `[ERR_SQLITE_ERROR] unable to open database file`。
   **换机器/换工作区时这一行必须改。**
3. **DevHub 登记需要放开沙箱**：`~/.devhub/registry` 与 `~/.devhub/state` 在工作区之外，
   而全局规则要求长驻服务必须经 `devctl` 启停，因此登记/启动命令可能需要一次提权重试。
4. **开发容器没有中文字体**：`fc-match sans-serif:lang=zh-cn` 会落到 DejaVu Sans，
   在此容器内用 headless 浏览器截图时中文显示为方框。应用已显式声明中文字体族
   （`index.css` 的 `--font-sans` 与画布 `UI_FONT`），在有字体的客户端上显示正常。


## 目录结构

```
toposmith/
├─ docs/                需求、领域模型、目录表、架构、引擎、诊断契约、路线图、决策记录
├─ assets/brand/        标识源文件：mark.svg（图形）+ 两种主题的字标
├─ scripts/             build-brand.mjs：由标识源派生 favicon 与 PNG
├─ packages/
│  ├─ schema/           类型定义 + 导入校验（输入契约）
│  ├─ catalog/          设备/端口/线缆/速率目录（纯数据）
│  └─ engine/           推演内核（纯 TS，零 DOM/React 依赖，可在 Node 下测试）
└─ apps/web/            React 19 + Vite 8 + Tailwind 4（类名内联写法）
```

依赖方向严格单向：`web → engine → catalog → schema`。

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/00-overview.md` | 定位、核心判断（推演≠仿真）、非目标、术语 |
| `docs/01-requirements.md` | FR/NFR/NG 全量需求与验收标准 |
| `docs/02-domain-model.md` | 领域模型、数据 Schema、不变量 |
| `docs/03-catalog.md` | 设备/端口/线缆目录与五条物理硬约束 |
| `docs/04-architecture.md` | 分层、包边界、渲染方案、状态管理 |
| `docs/05-engine.md` | 链路协商、广播域、路由、逐跳推演、带宽、DNS |
| `docs/06-addressing.md` | IP/网段/VLAN/DHCP/DNS 模型 |
| `docs/07-diagnostics.md` | 诊断输出契约、原因码表、证据链呈现规范 |
| `docs/08-roadmap.md` | M0–M4 里程碑与验收、风险登记 |
| `docs/DECISIONS.md` | 决策记录（ADR） |

## 能力速览（当前 M0）

- **绘制**：设备目录拖放 / **端口画在面板上**（网口·光口·PON·天线按介质绘制，点击即编辑详情；
  **有背板端口的设备可一键翻面**）/
  **端口到端口的电缆曲线** / **设备的端口可增删** / **机柜容器**（1–24U、上架下架、翻转看背面、
  悬浮半透明、端口按正/背面显示）/
  **有背板端口的设备悬浮即透视**（卡片半透明 + 露出背面端口图元，与机柜同一套规则）/
  线缆类型与长度 / 缩放平移 /
  **框选与 Ctrl·Shift 多选**（选中两台自动填入诊断）/
  **六向对齐 + 两轴等距分布** / **网格与节点对齐吸附（带引导线）** /
  **撤销重做（Ctrl+Z / Ctrl+Shift+Z）** / **网格吸附开关** / 导入导出
- **配色**：链路标签与连线本体按速率着色（**1G 红 → 10G 绿**，对数均匀分配，右上角图例）；
  **速率标签可沿连线拖动定位**（拖近中点自动吸附、双击复位），位置按弧长比例保存，
  缩放与移动设备后仍贴在原处
- **预置场景**：右上角「预置场景」打开选择弹窗，6 套开箱可用的真实拓扑
  （家庭 / 小微企业办公网 / 机房机柜 / 光接入 / 园区无线 / **中型托管 IDC**），
  每套都标注了它演示什么、规模多大，其中两套**特意留了一处配错**（VLAN 上联口、SSID）供排查练手。
  中型 IDC 那套是**规模压测场景**：3 机房 × 24 柜 × 42U 满配，810 台设备 / 809 条链路，
  拖动仍保持约 30 FPS（细节按缩放分级绘制）
- **交互**：缩放 **5%–400%**；画布右下角「?」一键查看按键教学（按键以键帽图标呈现）；
  右侧「检查器 / 连通性诊断」的高度比例可拖动（会记住）
- **手感**：拖设备时**连线有平面物理摆动**（拖得越快线身甩得越远，松手回摆几下再停）；
  **卡片宽度可调**（拖右边缘或检查器输入）；「适应视图」按真实画布尺寸把**设备 + 连线**
  完整装进视口（留白 28px，超大拓扑优先"装得下"）
- **诊断**：可达性、数据包链路、通讯速度、DNS 解析路径 —— 全部带**证据链**
- **可视化**：诊断后画布播放**流向动画**（粒子速度按链路速率对数映射、逐跳停顿、
  失败停在阻断点并红脉冲），可暂停 / 重放 / 倍速
- **建模**：VLAN、IP/网段、静态路由、DHCP、NAT、光猫桥接/路由、无线 SSID 与速率、PON

## 技术栈

TypeScript（strict）· pnpm workspaces · React 19 · Vite 8 · Tailwind CSS 4 · zustand

## 标识（Logo）

![TopoSmith mark](assets/brand/mark.svg)

三个方形端点是终端设备、中间圆形枢纽是交换机，连成字母 **T**（Topo 的首字母）；
配色取应用速率色标的两端：青（sky-400，界面强调色）→ 绿（emerald-400，链路可用）。
徽章底色是画布同色（slate-950），因此在浅色浏览器标签栏上也有清晰轮廓。

| 文件 | 用途 |
|---|---|
| `assets/brand/mark.svg` | 图形标识源文件（**唯一的几何事实来源**） |
| `assets/brand/logo-on-dark.svg` / `logo-on-light.svg` | 横版字标，分别用于深色 / 浅色背景（README 用 `<picture>` 按主题选择） |
| `apps/web/public/favicon.svg`、`favicon-16/32.png`、`apple-touch-icon.png`、`icon-192/512.png` | 由 `pnpm brand` 派生，**勿手工编辑**（`manifest.webmanifest` 引用后两者，供"添加到主屏幕"） |

改标识只需改 `assets/brand/mark.svg`（字标几何同步），然后跑一次 `pnpm brand`。
字标用系统字体栈渲染而非轮廓化，因此文案仍可编辑。

## 第三方资源与许可

| 资源 | 版本 | 许可 | 用途 |
|---|---|---|---|
| [Lucide](https://lucide.dev) | 1.46.0 | **ISC**（商用免费，无需在 UI 署名） | 设备/端口/界面图标，画布 `Path2D` 与 SVG 组件共用同一份数据 |

项目不包含任何厂商设备镜像、商标素材或私有配置文件。

## 许可与合规

项目不包含任何厂商设备镜像、商标素材或私有配置文件；目录中的设备与线缆参数
均为公开标准（TIA/EIA、IEEE 802.3/802.11、ISO/IEC 11801）的数值事实。
