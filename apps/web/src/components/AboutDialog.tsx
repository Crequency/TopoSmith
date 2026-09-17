/**
 * 关于弹窗（FR-64）
 *
 * 从顶栏左侧的品牌按钮打开。放"关于"而不是只放一个外链：开源项目被打开时，
 * 用户第一件想确认的事是"这是什么、什么版本、代码在哪、许可是什么、我的数据去哪了"。
 * 这五件事各占一行，比塞进 README 或 tooltip 更好找。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { GitHubIcon, Icon, uiIcon } from '../lib/icons';
import { APP_VERSION, LICENSE_NAME, PAGES_URL, REPO_URL } from '../lib/project';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-slate-800 py-2 last:border-b-0">
      <span className="w-[76px] shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-300">{children}</span>
    </div>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-400 underline decoration-sky-800 underline-offset-2 transition hover:text-sky-300 hover:decoration-sky-500"
    >
      {children}
    </a>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
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
        aria-labelledby="about-dialog-title"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              width={40}
              height={40}
              className="shrink-0"
            />
            <div className="flex flex-col">
              <h2 id="about-dialog-title" className="text-base font-bold tracking-tight text-slate-100">
                TopoSmith
              </h2>
              <span className="text-[11px] text-slate-500">拓扑匠 · 网络拓扑推演器</span>
            </div>
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

        <div className="flex flex-col px-5 py-2">
          <p className="py-3 text-[11px] leading-relaxed text-slate-400">
            从拓扑与配置出发，用图算法 + 约束求解算出<b className="text-slate-300">路径、可达性、带宽与 DNS 解析链</b>，
            并给出完整证据链。不是逐包仿真器：结果确定可复现，同输入同输出。
          </p>

          <Row label="版本">{APP_VERSION}（M0）</Row>
          <Row label="许可">
            {LICENSE_NAME} · 第三方资源见仓库 <code className="text-slate-400">docs/</code> 与 README
          </Row>
          <Row label="源码">
            <Link href={REPO_URL}>{REPO_URL.replace('https://', '')}</Link>
          </Row>
          <Row label="在线试用">
            <Link href={PAGES_URL}>{PAGES_URL.replace('https://', '')}</Link>
          </Row>
          <Row label="数据">
            全部留在你的浏览器里（localStorage）；没有任何后端，也不会向外发送拓扑
          </Row>
          <Row label="技术栈">
            TypeScript（strict）· React 19 · Vite 8 · Tailwind 4 · zustand · Canvas 2D · Lucide 图标
          </Row>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Icon node={uiIcon('help')} size={11} />
            画布右下角的「?」里有按键与鼠标操作
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="在 GitHub 上查看源码"
            className="flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-sky-500 hover:text-sky-300"
          >
            <GitHubIcon size={14} />
            GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
