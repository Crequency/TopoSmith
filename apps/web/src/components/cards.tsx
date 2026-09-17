/**
 * 页面内容登记表（FR-70）
 *
 * 页面可以在左右侧栏之间搬家，所以"某张页面渲染什么"**只能有一份定义**。
 * 之前左右侧栏各写一个 renderCard，结果是把「节点树」拖到右侧栏时，
 * 右侧栏的 renderCard 不认识这个 id，落到了它的 else 分支上 —— 于是节点树的位置
 * 渲染出了「连通性诊断」的内容（端到端脚本当时只断言了顺序、没断言内容，没抓到）。
 * 教训：**按 id 分发的地方，未知 id 必须显式处理**。
 */

import type { ReactNode } from 'react';
import { Diagnostics } from './Diagnostics';
import { Inspector } from './Inspector';
import { NodeTree } from './NodeTree';
import { Palette } from './Palette';
import { useApp } from '../state/store';

/** 页面内容：id → 组件；不认识的 id 明确报出一条提示，而不是"渲染成别的页面" */
export function renderSidebarCard(cardId: string): ReactNode {
  switch (cardId) {
    case 'palette':
      return <Palette />;
    case 'tree':
      return <NodeTree />;
    case 'inspector':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Inspector />
        </div>
      );
    case 'diagnostics':
      return <Diagnostics />;
    default:
      return <p className="px-3 py-2 text-[11px] text-slate-500">未知页面「{cardId}」。</p>;
  }
}

/** 页面标题的补充说明（右栏面板标题栏右侧那行小字） */
export function sidebarCardHint(cardId: string): string | undefined {
  switch (cardId) {
    case 'tree':
      return '双击定位';
    case 'inspector':
      return '选中设备或线缆';
    default:
      return undefined;
  }
}

/** 面板标题栏里的动作按钮（诊断面板：清空 DNS 缓存） */
export function SidebarCardActions({ cardId }: { cardId: string }): ReactNode {
  const clearDnsCache = useApp((s) => s.clearDnsCache);
  const cacheSize = useApp((s) => s.diag.cache.size);

  if (cardId !== 'diagnostics') return null;
  return (
    <button
      type="button"
      onClick={clearDnsCache}
      title="清空后下次解析会走完整链路（教学演示用）"
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-sky-600 hover:text-sky-300"
    >
      DNS 缓存 {cacheSize} 条 · 清空
    </button>
  );
}
