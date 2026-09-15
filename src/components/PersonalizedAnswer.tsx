import { useEffect, useRef, useState } from 'react';
import type { AidAnalysis } from '../core';
import { createAsker, type AskAnswer } from '../ask/asker';
import { Card } from './ui';
import styles from './PersonalizedAnswer.module.css';

export function PersonalizedAnswer({ analysis, question, label = 'Explain using my documents' }: { analysis: AidAnalysis | null; question: string; label?: string }) {
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  async function ask() {
    if (!analysis?.reviewed || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setAnswer(null);
    const timeout = window.setTimeout(() => controller.abort(), 55000);
    try {
      const response = await createAsker().ask(question, analysis, { signal: controller.signal });
      if (active.current === controller) setAnswer(response);
    } catch (failure) {
      if (active.current === controller) setError(controller.signal.aborted ? 'That took too long. Please try again.' : failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <Card>
    <div className={styles.content}>
      <h2>Your documents, explained</h2>
      {!analysis?.reviewed ? <p><a href={analysis?.summaryToken ? '/beta/results' : '/beta'}>Upload and review your documents</a> to get a personalized explanation here.</p>
        : <button className={styles.button} type="button" disabled={busy} onClick={() => void ask()}>{busy ? 'Preparing your explanation…' : error ? 'Try again' : label}</button>}
      <div aria-live="polite" aria-busy={busy}>
        {error && <p role="alert">{error}</p>}
        {answer && <><p className={styles.caption}>{answer.basis === 'personal' ? 'Based on your reviewed document fields' : 'General explanation — relevant figures are missing'}</p>
          {answer.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          {answer.missing && <p>{answer.missing}</p>}
          {answer.grounding.length > 0 && <details><summary>Document references</summary><ul>{answer.grounding.map((source, i) => <li key={i}>{source}</li>)}</ul></details>}
          <p className={styles.caption}>AI explanations can be wrong. Confirm aid decisions and current requirements with your school.</p></>}
      </div>
    </div>
  </Card>;
}
