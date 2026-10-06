import { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../ui';
import type { PillTone } from '../ui/Pill';
import {
  formatChange, formatRate, formatValue, isImprovement, labelFor, parseBriefFailure, parseBriefResult, parseSnapshot,
} from '../../intelligence/contract';
import type { BriefFailure, BriefResult, Comparison, Level, Period, Snapshot } from '../../intelligence/contract';
import styles from './IntelligencePanel.module.css';

/**
 * FYNLIQ Intelligence, inside the Command Center (/admin).
 *
 * Top: the deterministic snapshot (computed in code, no AI) — loads on open.
 * Below: the CEO brief, generated on request by FynliqAnalyst and validated
 * on the server. Nothing here can change production data.
 */

const ENDPOINT = '/api/beta-admin';
const HEADLINE = ['newVisitors', 'signups', 'uploads', 'questions', 'checkoutStarts', 'payments', 'revenueCents'];
const STAGES = ['visitorToSignup', 'signupToUpload', 'uploadToCheckout', 'checkoutToPayment'];
const HEALTH_TONE: Record<string, PillTone> = { good: 'green', watch: 'gold', concerning: 'rust' };
const LEVEL_TONE: Record<Level, PillTone> = { low: 'neutral', medium: 'gold', high: 'green' };
const RISK_TONE: Record<Level, PillTone> = { low: 'green', medium: 'gold', high: 'rust' };

const day = (iso: string) => iso.slice(0, 10);
const periodLabel = (s: Snapshot) => (s.period.type === 'day' ? `${day(s.period.start)} (UTC)` : `${day(s.period.start)} to ${day(new Date(Date.parse(s.period.end) - 1).toISOString())} (UTC)`);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** Green for good news, rust for bad news: a rise in failures is bad news. */
const toneOf = (good: boolean | null) => (good === null ? styles.flat : good ? styles.up : styles.down);

function ChangeText({ c }: { c: Comparison }) {
  const w = c.previous;
  const good = !w || w.changePercent === null || w.changePercent === 0 ? null : (w.changePercent > 0) !== c.lowerIsBetter;
  const tone = toneOf(good);
  return <span className={tone}>{formatChange(w)} <span className={styles.muted}>vs previous</span></span>;
}

function SampleNote({ c }: { c: Comparison }) {
  if (c.reliability === 'ok' || c.reliability === 'unavailable') return null;
  const n = c.kind === 'rate' ? c.denominator : c.current;
  return <span className={styles.sample}>small sample{n !== null && n !== undefined ? ` (n=${n})` : ''}</span>;
}

function SnapshotView({ snapshot }: { snapshot: Snapshot }) {
  const by = new Map(snapshot.comparisons.map((c) => [c.metric, c]));
  const bottleneck = snapshot.candidates.primaryBottleneck;
  return (
    <>
      <div className={styles.kpis}>
        {HEADLINE.map((key) => {
          const c = by.get(key);
          if (!c) return null;
          return (
            <Card key={key} flat className={styles.kpi}>
              <span className={styles.kpiLabel}>{c.label.replace(' (cents, live)', ' (live)')}</span>
              <span className={styles.kpiValue}>{formatValue(c, c.current)}</span>
              {c.current === null ? <span className={styles.muted}>not collected yet</span> : <ChangeText c={c} />}
              <SampleNote c={c} />
            </Card>
          );
        })}
      </div>
      <ol className={styles.funnel} aria-label="Funnel conversion">
        {STAGES.map((key) => {
          const c = by.get(key);
          if (!c) return null;
          const isBottleneck = key === bottleneck;
          return (
            <li key={key} className={isBottleneck ? `${styles.step} ${styles.stepHot}` : styles.step}>
              <span className={styles.stepLabel}>{c.label}</span>
              <span className={styles.stepValue}>{formatRate(c.current)}</span>
              <span className={styles.muted}>
                {c.numerator ?? '—'} of {c.denominator ?? '—'}
                {/* Only a same-length window is a fair comparison for a cohort conversion rate. */}
                {c.previous?.value !== null && c.previous?.value !== undefined ? ` · previous ${formatRate(c.previous.value)}` : ''}
              </span>
              {isBottleneck && <Pill tone="rust">Bottleneck</Pill>}
              <SampleNote c={c} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Levels({ action }: { action: BriefResult['brief']['recommendedAction'] }) {
  return (
    <div className={styles.chips}>
      <Pill tone={LEVEL_TONE[action.expectedImpact]} glyph={false}>Impact: {action.expectedImpact}</Pill>
      <Pill tone="neutral" glyph={false}>Effort: {action.implementationEffort}</Pill>
      <Pill tone={RISK_TONE[action.risk]} glyph={false}>Risk: {action.risk}</Pill>
      <Pill tone={LEVEL_TONE[action.confidence]} glyph={false}>Confidence: {action.confidence}</Pill>
    </div>
  );
}

function BriefView({ result, snapshot }: { result: BriefResult; snapshot: Snapshot | null }) {
  const { brief } = result;
  const arrow = brief.biggestChange.direction === 'up' ? '↑' : brief.biggestChange.direction === 'down' ? '↓' : '→';
  return (
    <div className={styles.brief}>
      <Card hero className={styles.summary}>
        <span className={styles.eyebrow}>Executive summary</span>
        <p className={styles.summaryText}>{brief.executiveSummary}</p>
      </Card>

      <div className={styles.grid}>
        <Card flat>
          <span className={styles.eyebrow}>Company health</span>
          <p className={styles.headline}><Pill tone={HEALTH_TONE[brief.health.status]}>{brief.health.status}</Pill></p>
          <p className={styles.body}>{brief.health.reason}</p>
        </Card>

        <Card flat>
          <span className={styles.eyebrow}>Biggest change</span>
          <p className={styles.headline}>
            {brief.biggestChange.metric === 'none' ? 'No comparable change'
              : <>{labelFor(brief.biggestChange.metric, snapshot)} <span className={toneOf(isImprovement(brief.biggestChange.metric, brief.biggestChange.direction, snapshot))}>{arrow} {brief.biggestChange.magnitude}%</span></>}
          </p>
          <p className={styles.body}>{brief.biggestChange.explanation}</p>
        </Card>

        <Card flat>
          <span className={styles.eyebrow}>Primary bottleneck</span>
          <p className={styles.headline}>{brief.primaryBottleneck.stage === 'insufficient_data' ? 'Not enough data' : brief.primaryBottleneck.label}</p>
          <ul className={styles.list}>{brief.primaryBottleneck.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        </Card>

        <Card flat>
          <span className={styles.eyebrow}>Metric to watch</span>
          <ul className={styles.watch}>
            {brief.watchMetrics.map((m) => <li key={m}>{labelFor(m, snapshot)}{m === brief.recommendedAction.metricToImprove ? <span className={styles.muted}> · target of the action</span> : null}</li>)}
          </ul>
        </Card>
      </div>

      <Card className={styles.action}>
        <span className={styles.eyebrow}>Recommended action</span>
        <p className={styles.actionTitle}>{brief.recommendedAction.title}</p>
        <p className={styles.body}>{brief.recommendedAction.reason}</p>
        <Levels action={brief.recommendedAction} />
        <p className={styles.muted}>Improves: {labelFor(brief.recommendedAction.metricToImprove, snapshot)}. A human decides whether to act; nothing is changed automatically.</p>
      </Card>

      <Card flat>
        <span className={styles.eyebrow}>Hypotheses — possible causes, not verified</span>
        <ul className={styles.hypotheses}>
          {brief.hypotheses.map((h) => (
            <li key={h.hypothesis}>
              <span>{h.hypothesis}</span>
              <Pill tone={LEVEL_TONE[h.confidence]} glyph={false}>{h.confidence} confidence</Pill>
              <span className={styles.muted}>Evidence: {h.evidence}</span>
            </li>
          ))}
        </ul>
      </Card>

      {brief.dataQualityWarnings.length > 0 && (
        <Card sunk>
          <span className={styles.eyebrow}>Data quality warnings</span>
          <ul className={styles.list}>{brief.dataQualityWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Card>
      )}

      <p className={styles.meta}>
        Generated {when(result.generatedAt)} · {result.provider} / {result.model} · <code>{result.requestId}</code>
      </p>
    </div>
  );
}

export function IntelligencePanel() {
  const [period, setPeriod] = useState<Period>('day');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [result, setResult] = useState<BriefResult | null>(null);
  const [failure, setFailure] = useState<BriefFailure | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let live = true;
    setSnapshot(null); setSnapshotError(''); setResult(null); setFailure(null);
    fetch(`${ENDPOINT}?view=intelligence-snapshot&period=${period}`, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return parseSnapshot((await r.json())?.snapshot); })
      .then((s) => { if (!live) return; if (s) setSnapshot(s); else setSnapshotError('The metrics snapshot could not be read.'); })
      .catch(() => { if (live) setSnapshotError('The metrics snapshot is not available right now.'); });
    return () => { live = false; };
  }, [period]);

  const generate = useCallback(async () => {
    setGenerating(true); setFailure(null);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'intelligence-brief', period }),
      });
      const json: unknown = await r.json().catch(() => null);
      const parsed = r.ok ? parseBriefResult(json) : null;
      if (parsed) { setResult(parsed); if (parsed.snapshot) setSnapshot(parsed.snapshot); }
      else setFailure(parseBriefFailure(json, r.status));
    } catch {
      setFailure(parseBriefFailure(null, 0));
    } finally {
      setGenerating(false);
    }
  }, [period]);

  return (
    <section className={styles.panel} aria-labelledby="fynliq-intelligence">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Read-only · decision support</span>
          <h2 id="fynliq-intelligence" className={styles.title}>FYNLIQ Intelligence</h2>
          {snapshot && <p className={styles.muted}>{periodLabel(snapshot)} · {snapshot.dataSource === 'rpc' ? 'all metrics' : 'limited metrics (migration not applied)'}</p>}
        </div>
        <div className={styles.controls}>
          <div className={styles.toggle} role="group" aria-label="Period">
            {(['day', 'week'] as const).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} className={period === p ? styles.toggleOn : undefined} onClick={() => setPeriod(p)} disabled={generating}>
                {p === 'day' ? 'Yesterday' : 'Last 7 days'}
              </button>
            ))}
          </div>
          <button type="button" className={styles.generate} onClick={() => void generate()} disabled={generating || !snapshot}>
            {generating ? 'Generating brief…' : result ? 'Regenerate brief' : 'Generate CEO brief'}
          </button>
        </div>
      </header>

      {!snapshot && !snapshotError && <p className={styles.muted} role="status">Loading metrics…</p>}
      {snapshotError && <p className={styles.muted} role="alert">{snapshotError}</p>}
      {snapshot && <SnapshotView snapshot={snapshot} />}

      {generating && <p className={styles.muted} role="status">The analyst is reading the metrics. This can take up to a minute.</p>}
      {failure && (
        <Card sunk className={styles.failure} role="alert">
          <p className={styles.body}>{failure.error === 'intelligence_disabled' ? 'The AI brief is turned off. The metrics above are still live and computed without AI.' : failure.message}</p>
          {failure.requestId && <p className={styles.meta}>Request <code>{failure.requestId}</code></p>}
        </Card>
      )}
      {result && <BriefView result={result} snapshot={snapshot} />}
      {!result && snapshot && !failure && !generating && (
        <p className={styles.muted}>Numbers above are computed in code. The brief adds interpretation: what changed, the bottleneck, hypotheses and one recommended action.</p>
      )}
    </section>
  );
}
