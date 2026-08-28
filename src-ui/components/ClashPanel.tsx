import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '@/lib/types';
import Panel from './ui/Panel';
import Switch from './ui/Switch';

interface Props {
  config: AppConfig;
  onUpdate: (fn: (c: AppConfig) => AppConfig) => void;
}

export default function ClashPanel({ config, onUpdate }: Props) {
  const { t } = useTranslation();
  const clash = config.clash;
  const [testResult, setTestResult] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const updateClash = (patch: Partial<AppConfig['clash']>) => {
    onUpdate((c) => ({ ...c, clash: { ...c.clash, ...patch } }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const headers: Record<string, string> = {};
      if (clash.secret) headers['Authorization'] = `Bearer ${clash.secret}`;
      const base = clash.api.replace(/\/+$/, '');
      const res = await fetch(`${base}/version`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const gRes = await fetch(`${base}/proxies/${encodeURIComponent(clash.group)}`, { headers, signal: AbortSignal.timeout(5000) });
      if (!gRes.ok) throw new Error(`Group ${clash.group} not found: ${gRes.status}`);
      const gData = await gRes.json();
      setTestResult(`✓ ${data.version || 'ok'} | ${clash.group}: ${gData.now} (${gData.all?.length||0} nodes)`);
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Panel title={t('section.clash.title')} subtitle={t('section.clash.sub')}>
      <div className="space-y-4">
        <div className="surface-card flex items-center justify-between gap-3 p-4">
          <div>
            <div className="font-serif text-[18px]">{t('clash.enable')}</div>
            <div className="mt-1 text-xs text-muted">{t('clash.enable.desc')}</div>
          </div>
          <Switch checked={clash.enabled} onChange={(v) => updateClash({ enabled: v })} />
        </div>

        <div className={`space-y-4 ${!clash.enabled ? 'opacity-45 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.api')}</span>
              <input
                value={clash.api}
                onChange={(e) => updateClash({ api: e.target.value })}
                placeholder="http://127.0.0.1:9097"
                className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
              />
              <span className="text-[11px] text-muted">{t('clash.api.desc')}</span>
            </label>
            <label className="space-y-2">
              <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.fallbackApi')}</span>
              <input
                value={clash.fallbackApi}
                onChange={(e) => updateClash({ fallbackApi: e.target.value })}
                placeholder="http://127.0.0.1:9090"
                className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>

          <label className="space-y-2">
            <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.secret')}</span>
            <input
              type="password"
              value={clash.secret}
              onChange={(e) => updateClash({ secret: e.target.value })}
              placeholder={t('clash.secret.placeholder')}
              className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
            />
            <span className="text-[11px] text-muted">{t('clash.secret.desc')}</span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.group')}</span>
              <input
                value={clash.group}
                onChange={(e) => updateClash({ group: e.target.value })}
                placeholder="🚀 节点选择"
                className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
              />
              <span className="text-[11px] text-muted">{t('clash.group.desc')}</span>
            </label>
            <label className="space-y-2">
              <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.dedupeMs')}</span>
              <input
                type="number"
                value={clash.dedupeMs}
                onChange={(e) => updateClash({ dedupeMs: parseInt(e.target.value || '0', 10) })}
                className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
              />
              <span className="text-[11px] text-muted">{t('clash.dedupeMs.desc')}</span>
            </label>
          </div>

          <label className="space-y-2">
            <span className="text-xs tracking-[0.12em] uppercase text-muted">{t('clash.excludeNodes')}</span>
            <input
              value={clash.excludeNodes.join(',')}
              onChange={(e) => updateClash({ excludeNodes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="DIRECT,REJECT"
              className="w-full rounded-2xl border border-white/[0.10] bg-black/20 px-3 py-2 text-sm outline-none"
            />
            <span className="text-[11px] text-muted">{t('clash.excludeNodes.desc')}</span>
          </label>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
            {t('clash.hint')}
          </div>

          <div className="surface-card p-4">
            <div className="mb-3 text-xs tracking-[0.12em] uppercase text-muted">{t('clash.sources')}</div>
            <div className="grid grid-cols-2 gap-3">
              {(['opencode','claude','codex','gemini'] as const).map((k) => (
                <label key={k} className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-black/20 px-3 py-2">
                  <span className="text-sm capitalize">{k}</span>
                  <Switch
                    checked={!!clash.sources?.[k]}
                    onChange={(v) => updateClash({ sources: { ...clash.sources, [k]: v } })}
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-muted">{t('clash.sources.desc')}</div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {testing ? t('clash.testing') : t('clash.test')}
            </button>
            {testResult && <span className="text-xs break-all">{testResult}</span>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
