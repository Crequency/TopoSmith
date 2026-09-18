# 参与开发

欢迎提 issue 与 PR。下面是你在这个仓库里工作最需要知道的几件事；**产品与引擎的设计理由**
在 [`docs/DECISIONS.md`](docs/DECISIONS.md)（每个决策都写了"为什么没选另一条路"与代价），
需求与验收标准在 [`docs/01-requirements.md`](docs/01-requirements.md)。

## 环境

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node | ≥ 20（CI 用 22） | 见 `package.json` 的 `engines` |
| pnpm | 11（`packageManager` 字段已固定） | pnpm 11 不读项目 `.npmrc`，工作区配置写在 `pnpm-workspace.yaml` |
| Playwright 的 Chromium | 可选 | 只有 `pnpm screenshot` / `pnpm brand` 需要 |

```bash
pnpm install
pnpm dev          # 开发服务器（vite.config.ts 里固定 0.0.0.0:31006 + strictPort）
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器 |
| `pnpm typecheck` | 四个包的全量类型检查（`tsc --noEmit`） |
| `pnpm test` | 引擎单测（纯 Node，无 jsdom） |
| `pnpm test:web` | 前端单测（几何 / 布局 / store / 预置场景行为） |
| `pnpm check` | 上面三项一起跑 |
| `pnpm build` | 生产构建到 `apps/web/dist` |
| `pnpm preview` | 预览构建产物 |
| `pnpm screenshot` | 重新生成 README 的界面截图 |
| `pnpm brand` | 由 `assets/brand/mark.svg` 重新派生 favicon / PNG |

端到端脚本（真实 Chromium 驱动）**不在仓库里**：它们是本机验证脚本，改动画布交互、
侧栏布局或诊断面板时请在本机跑一遍，覆盖启动、四类诊断、多选与框选、对齐吸附、机柜与翻转、
标签拖拽、悬浮透视、侧栏页签与命令菜单以及性能预算。

## 代码约定

- **TypeScript strict**，`verbatimModuleSyntax`：类型导入要写 `import type`；
- **样式全部用 Tailwind 内联类名**，不引入语义 CSS 类、不用 `@apply`（唯一例外是
  `index.css` 的 `@import "tailwindcss"` 与少量全局基线）；
- **依赖方向严格单向**：`apps/web → @toposmith/anvil → @toposmith/catalog → @toposmith/schema`。
  内核（`packages/engine`）**零 DOM / 零 React**，能在 Node 下单测；
- **引擎里没有随机数与时钟**：时间这类外部输入一律当参数传进去（DNS 的 `nowMs` 就是例子），
  保证"同输入同输出"；
- 画布**不做任何网络语义判断**：能不能连、协商成多少，问引擎的 `negotiateLink`。

## 改一个功能时应该带上的东西

这个仓库的惯例是"**结论要能核对**"，所以一个可合并的改动通常包含：

1. **需求条目**：在 `docs/01-requirements.md` 加/改一条 FR，写清验收标准（可测的那种）；
2. **决策记录**：涉及取舍时在 `docs/DECISIONS.md` 追加一条，写背景、决策、代价；
3. **单测**：引擎逻辑落在 `packages/engine/src/__tests__`，前端纯函数与 store 行为落在
   `apps/web/src/lib/__tests__` / `src/state/__tests__`；
4. **文档同步**：受影响的 `docs/0x-*.md`（含本文与 `docs/09-deployment.md`）。

文案与注释用中文；提交信息也用中文，按 `feat/fix/docs/ci/refactor(scope): 摘要` 的风格写，
**说清"为什么"而不只是"改了什么"**。

## 预置场景

预置场景是**产品内容**，不是示例数据：每套场景都要演示一类能力，且说明里承诺的行为
会被 `presets.test.ts` 逐条验证（能通的通、该报的错报对、"有意留的坑"要能修好）。
写场景前请先看 `docs/01-requirements.md` 的 FR-55（三条建模约束）。

## 品牌与截图产物

| 文件 | 用途 |
|---|---|
| `assets/brand/mark.svg` | 图形标识源文件（**唯一的几何事实来源**） |
| `assets/brand/logo-on-dark.svg` / `logo-on-light.svg` | 横版字标，README 按主题选择 |
| `apps/web/public/favicon.svg`、`favicon-16/32.png`、`apple-touch-icon.png`、`icon-192/512.png` | 由 `pnpm brand` 派生，**勿手工编辑** |

改标识只需改 `mark.svg`（字标几何同步），再跑 `pnpm brand`；改主图跑 `pnpm screenshot`。
两个脚本共用 `scripts/playwright.mjs` 的 Chromium 加载器（可用 `PLAYWRIGHT_PATH` 指向已有安装）。

## 部署与打包

见 [`docs/09-deployment.md`](docs/09-deployment.md)：静态托管与基路径、GitHub Pages、
容器镜像（Docker + Caddy）、端口策略、镜像仓库与推送。
