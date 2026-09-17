/** 左侧面板：设备目录 / 节点树 两个页签（FR-43） */

import { useState } from 'react';
import { NodeTree } from './NodeTree';
import { Palette } from './Palette';

type Tab = 'palette' | 'tree';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('palette');

  return (
    <div className="flex min-h-0 w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex shrink-0 border-b border-slate-800">
        {(
          [
            ['palette', '设备目录'],
            ['tree', '节点树'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 border-b-2 px-2 py-2 text-[11px] font-medium transition ${
              tab === id
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'palette' ? <Palette /> : <NodeTree />}
    </div>
  );
}
