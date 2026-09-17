/** 诊断面板：四类诊断的入口与证据链呈现 */

import { useMemo } from 'react';
import { addressesOf, type DiagResult, type DiagStep } from '@toposmith/engine';
import { formatMbpsAsBytesPerSecond, formatSpeed } from '@toposmith/catalog';
import { useApp } from '../state/store';
import { Button, Field, TextInput } from './ui';

const LEVEL_STYLE: Record<DiagStep['level'], { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: '通过' },
  info: { dot: 'bg-slate-500', text: 'text-slate-300', label: '信息' },
  warn: { dot: 'bg-amber-400', text: 'text-amber-300', label: '提示' },
  error: { dot: 'bg-rose-500', text: 'text-rose-300', label: '失败' },
};

export function Diagnostics() {
  const world = useApp((s) => s.world);
  const scenario = useApp((s) => s.scenario);
  const diag = useApp((s) => s.diag);

  const setDiagSrc = useApp((s) => s.setDiagSrc);
  const setDiagDst = useApp((s) => s.setDiagDst);
  const setDnsName = useApp((s) => s.setDnsName);
  const runDiag = useApp((s) => s.runDiag);
  const clearDnsCache = useApp((s) => s.clearDnsCache);

  // 可选源：有地址的设备优先（没有地址的设备作为源只会得到"无地址"结论）
  const sourceOptions = useMemo(
    () =>
      world.ordered
        .map((device) => {
          const addresses = addressesOf(world, device.id);
          const lease = world.leases.get(device.id);
          return {
            id: device.id,
            name: device.name,
            address: addresses[0]?.ip ?? (lease?.failure ? '（无地址）' : ''),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [world],
  );

  // 目标建议：所有已知地址 + 预置的公网目标
  const targetSuggestions = useMemo(() => {
    const list: { ip: string; label: string }[] = [];
    for (const device of world.ordered) {
      for (const address of addressesOf(world, device.id)) {
        list.push({ ip: address.ip, label: `${device.name} · ${address.ip}` });
      }
    }
    list.push({ ip: '203.0.113.10', label: '云侧示例站点 · 203.0.113.10' });
    return list;
  }, [world]);

  const stale = diag.result !== null && diag.ranOn !== scenario.updatedAt;

  return (
    <section className="flex min-h-0 flex-col border-t border-slate-800">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-300">连通性诊断</h2>
        <button
          type="button"
          onClick={clearDnsCache}
          className="text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300"
          title="清空后下次解析会走完整链路（教学演示用）"
        >
          DNS 缓存 {diag.cache.size} 条 · 清空
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-slate-800 p-3">
          {diag.fromSelection && (
            <div className="rounded border border-sky-800 bg-sky-500/10 px-2 py-1 text-[10px] leading-snug text-sky-200">
              已由选中设备填入：<span className="font-semibold">
                {world.devices.get(diag.fromSelection.srcId)?.name ?? diag.fromSelection.srcId}
              </span>
              {' → '}
              <span className="font-semibold">
                {world.devices.get(diag.fromSelection.dstId)?.name ?? diag.fromSelection.dstId}
              </span>
              （先选中的为源）。继续 Ctrl+点击可换目标。
            </div>
          )}
          <Field label="源设备">
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
              value={diag.srcId}
              onChange={(event) => setDiagSrc(event.target.value)}
            >
              <option value="">（请选择）</option>
              {sourceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.address ? ` · ${option.address}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="目标 IP" hint="可从下拉建议中选择，也可直接输入任意 IPv4">
            <TextInput value={diag.dstIp} onChange={setDiagDst} placeholder="192.168.1.2" />
          </Field>
          <div className="flex flex-wrap gap-1">
            {targetSuggestions.slice(0, 12).map((suggestion) => (
              <button
                key={`${suggestion.ip}-${suggestion.label}`}
                type="button"
                onClick={() => setDiagDst(suggestion.ip)}
                title={suggestion.label}
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-sky-600 hover:text-sky-300"
              >
                {suggestion.ip}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button variant="primary" onClick={() => runDiag('ping')}>
              可达性
            </Button>
            <Button onClick={() => runDiag('trace')}>数据包链路</Button>
            <Button onClick={() => runDiag('bandwidth')}>通讯速度</Button>
          </div>

          <div className="mt-1 border-t border-slate-800 pt-2">
            <Field label="域名解析">
              <TextInput value={diag.dnsName} onChange={setDnsName} placeholder="www.example.com" />
            </Field>
            <div className="mt-1.5">
              <Button onClick={() => runDiag('dns')}>DNS 解析路径</Button>
            </div>
          </div>
        </div>

        {stale && (
          <div className="border-b border-slate-800 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            拓扑已改动，下方结果来自改动之前 —— 请重新运行诊断。
          </div>
        )}

        {diag.result ? <ResultView result={diag.result} /> : <EmptyHint />}
      </div>
    </section>
  );
}

function EmptyHint() {
  return (
    <div className="p-3 text-[11px] leading-relaxed text-slate-500">
      选择源设备与目标，然后运行诊断。
      <br />
      每个结论都会给出**证据链**：不只告诉你通不通，还告诉你卡在哪一层、为什么。
      <br />
      建议先试：笔记本 → <span className="text-slate-400">203.0.113.10</span>（云侧），
      再试 <span className="text-slate-400">192.168.1.2</span>（同网段交换机）。
    </div>
  );
}

function ResultView({ result }: { result: DiagResult }) {
  const firstErrorIndex = result.steps.findIndex((step) => step.level === 'error');

  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          result.ok
            ? 'border-emerald-700 bg-emerald-500/10 text-emerald-200'
            : 'border-rose-800 bg-rose-500/10 text-rose-200'
        }`}
      >
        <div className="font-semibold">{result.ok ? '✓ 推演通过' : '✗ 推演失败'}</div>
        <div className="mt-0.5 leading-snug">{result.summary}</div>
      </div>

      {result.metrics && <MetricsView result={result} />}

      {result.hops.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-slate-400">
            {result.kind === 'dns' ? '解析链' : '逐跳路径'}
          </h3>
          <ol className="flex flex-col gap-1">
            {result.hops.map((hop) => (
              <li
                key={`${hop.index}-${hop.deviceId}`}
                className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="w-4 shrink-0 text-right font-mono text-slate-500">
                    {hop.index + 1}
                  </span>
                  <span className="font-medium text-slate-200">{hop.deviceName}</span>
                  {hop.inPort && <span className="text-slate-500">入 {hop.inPort}</span>}
                  {hop.outPort && <span className="text-slate-500">出 {hop.outPort}</span>}
                  {hop.linkSpeedMbps !== undefined && hop.linkSpeedMbps > 0 && (
                    <span className="ml-auto shrink-0 text-slate-400">
                      {hop.linkFamily === 'wireless' ? 'WiFi ' : ''}
                      {formatSpeed(hop.linkSpeedMbps)}
                    </span>
                  )}
                </div>
                {hop.nextHopIp && (
                  <div className="pl-5 text-[10px] text-slate-500">下一跳 {hop.nextHopIp}</div>
                )}
                {hop.note && <div className="pl-5 text-[10px] text-emerald-400">{hop.note}</div>}
                {hop.linkIssues?.map((issue) => (
                  <div key={issue} className="pl-5 text-[10px] text-amber-400">
                    {issue}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-[11px] font-semibold text-slate-400">
          证据链（{result.steps.length} 步）
        </h3>
        <ol className="flex flex-col gap-1">
          {result.steps.map((step, index) => {
            const style = LEVEL_STYLE[step.level];
            return (
              <li key={`${step.code}-${index}`}>
                <details
                  open={index === firstErrorIndex}
                  className="rounded border border-slate-800 bg-slate-950/60"
                >
                  <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px]">
                    <span className={`size-2 shrink-0 rounded-full ${style.dot}`} />
                    <span className={`font-medium ${style.text}`}>{step.title}</span>
                    <code className="ml-auto shrink-0 font-mono text-[9px] text-slate-600">
                      {step.code}
                    </code>
                  </summary>
                  <p className="border-t border-slate-800/60 px-2 py-1.5 text-[11px] leading-relaxed text-slate-400">
                    {step.detail}
                  </p>
                </details>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function MetricsView({ result }: { result: DiagResult }) {
  const metrics = result.metrics;
  if (!metrics) return null;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
      <h3 className="mb-1.5 text-[11px] font-semibold text-slate-400">速度测算</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Metric label="瓶颈链路" value={formatSpeed(metrics.bottleneckMbps)} />
        <Metric label="单流有效吞吐" value={formatSpeed(metrics.effectiveMbps)} />
        <Metric label="单程时延" value={`${metrics.oneWayMs.toFixed(3)} ms`} />
        <Metric label="往返 RTT" value={`${metrics.rttMs.toFixed(3)} ms`} />
        <Metric label="1 GiB 传输" value={`${metrics.transfer1GiBSeconds.toFixed(1)} s`} />
        <Metric
          label="吞吐（字节）"
          value={formatMbpsAsBytesPerSecond(metrics.effectiveMbps)}
        />
      </dl>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
        瓶颈：{metrics.bottleneckLabel}
        {metrics.hasWireless && ` · 无线段共享，并发客户端 ${metrics.wirelessConcurrency} 台`}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  );
}
