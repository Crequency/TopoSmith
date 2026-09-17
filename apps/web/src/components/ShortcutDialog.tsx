/**
 * 按键提示弹窗（FR-59）
 *
 * 画布右下角原来是一条常驻的说明文字：又长又挤，还挡着画布。
 * 改成「?」按钮 + 弹窗之后，说明按类别摊开，而且**按键用按键图标（keycap）画出来**：
 * 「Ctrl+Shift+Z」这种写法要用户自己在脑子里拆，而 `Ctrl` `Shift` `Z` 三个键帽
 * 一眼就能看出是"三个键一起按"。
 *
 * 鼠标操作也用同一种样式的小标签（左键 / 中键 / 右键），保证"行的结构 = 操作的结构"。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, uiIcon } from '../lib/icons';

/** 一个键帽：等宽字体 + 下沿加厚，做出实键帽的观感 */
function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded border border-slate-600 border-b-2 border-b-slate-500 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200">
      {children}
    </kbd>
  );
}

/** 鼠标按键标签：与键帽同款，但用圆角胶囊表示"这是鼠标" */
function MouseButton({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
      {children}
    </span>
  );
}

/** 一行：左边是"怎么操作"，右边是"会怎样" */
function Row({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded px-2 py-1.5 odd:bg-slate-950/40">
      <div className="flex w-[190px] shrink-0 flex-wrap items-center gap-1">{keys}</div>
      <div className="text-[11px] leading-relaxed text-slate-300">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

const mod = typeof navigator === 'undefined' ? 'Ctrl' : /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function ShortcutDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon node={uiIcon('help')} size={16} className="text-sky-400" />
            <h2 id="shortcut-dialog-title" className="text-sm font-semibold text-slate-100">
              按键与鼠标操作
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            aria-label="关闭"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto px-3 py-3">
          <Section title="编辑与撤销">
            <Row keys={<><Kbd>{mod}</Kbd><Kbd>Z</Kbd></>}>撤销上一步</Row>
            <Row keys={<><Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></>}>重做（<Kbd>{mod}</Kbd>+<Kbd>Y</Kbd> 同样可用）</Row>
            <Row keys={<><Kbd>{mod}</Kbd><Kbd>A</Kbd></>}>全选设备</Row>
            <Row keys={<><Kbd>Delete</Kbd></>}>删除选中的设备 / 线缆（<Kbd>Backspace</Kbd> 同样可用）</Row>
            <Row keys={<><Kbd>Esc</Kbd></>}>取消连线、清空选择、退出连线模式</Row>
          </Section>

          <Section title="选择与移动">
            <Row keys={<><MouseButton>左键</MouseButton></>}>按住设备拖动来移动；从机柜外拖到机柜上即上架</Row>
            <Row keys={<><MouseButton>左键</MouseButton><span className="text-[10px] text-slate-500">拖空白</span></>}>框选一批设备</Row>
            <Row keys={<><MouseButton>左键</MouseButton><span className="text-[10px] text-slate-500">拖卡片右边缘</span></>}>调整卡片宽度（未上架设备）</Row>
            <Row keys={<><Kbd>{mod}</Kbd><span className="text-[10px] text-slate-500">/</span><Kbd>⇧</Kbd><span className="text-[10px] text-slate-500">+</span><MouseButton>左键</MouseButton></>}>
              追加选择：选中两台及以上时自动填入连通性诊断（先选中的是源）
            </Row>
          </Section>

          <Section title="面板与布局">
            <Row keys={<><Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>P</Kbd></>}>
              打开命令菜单（VSCode 同款快捷键；mac 上是 <Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>P</Kbd>）
            </Row>
            <Row keys={<><span className="text-[10px] text-slate-500">拖卡片标题</span></>}>
              侧栏卡片排序；拖到另一侧栏即换栏，点标题栏折叠 / 展开
            </Row>
            <Row keys={<><Kbd>Alt</Kbd><Kbd>↑</Kbd><span className="text-[10px] text-slate-500">/</span><Kbd>↓</Kbd></>}>
              把卡片在「本侧栏内」上移 / 下移（焦点在卡片标题上时）
            </Row>
            <Row keys={<><Kbd>Alt</Kbd><Kbd>←</Kbd><span className="text-[10px] text-slate-500">/</span><Kbd>→</Kbd></>}>
              把卡片移到左 / 右侧栏
            </Row>
            <Row keys={<><span className="text-[10px] text-slate-500">拖侧栏边缘</span></>}>
              调整侧栏宽度（<Kbd>←</Kbd><Kbd>→</Kbd> 微调，双击复位）
            </Row>
            <Row keys={<><span className="text-[10px] text-slate-500">拖卡片之间的横条</span></>}>
              调整右侧栏「检查器 / 诊断」的高度比例
            </Row>
          </Section>

          <Section title="画布导航">
            <Row keys={<><MouseButton>中键</MouseButton><span className="text-[10px] text-slate-500">/</span><MouseButton>右键</MouseButton><span className="text-[10px] text-slate-500">/</span><Kbd>Space</Kbd></>}>
              平移画布（<Kbd>Space</Kbd> 需按住）
            </Row>
            <Row keys={<><span className="text-[10px] text-slate-500">滚轮</span></>}>以指针为锚点缩放（5%–400%）</Row>
            <Row keys={<><Kbd>Alt</Kbd></>}>按住时临时关闭网格吸附</Row>
          </Section>

          <Section title="连线与端口">
            <Row keys={<><MouseButton>左键</MouseButton><span className="text-[10px] text-slate-500">点端口</span></>}>编辑端口详情（速率、介质、VLAN、正/背面）</Row>
            <Row keys={<><span className="text-[10px] text-slate-500">连线模式</span></>}>依次点两个端口建立链路；点空白取消</Row>
            <Row keys={<><span className="text-[10px] text-slate-500">拖动标签</span></>}>沿连线移动速率标签；双击标签复位到中点</Row>
            <Row keys={<><span className="text-[10px] text-slate-500">悬浮卡片</span></>}>有背板端口的设备会半透明并露出背面端口（悬停机柜同理）</Row>
            <Row keys={<><span className="text-[10px] text-slate-500">双击节点树</span></>}>把该设备移到视野正中</Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
