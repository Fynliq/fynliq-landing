import { useState } from 'react';
import type { AidAnalysis } from '../core';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import styles from './BetaResults.module.css';
import review from './SummaryReview.module.css';
import { PersonalizedAnswer } from '../components/PersonalizedAnswer';

export function SummaryReview({ analysis, onConfirm, onRestart }: { analysis: AidAnalysis; onConfirm: () => void; onRestart: () => void }) {
  const [checked, setChecked] = useState(false);
  return <FlowShell step={3}><div className={review.layout}>
    <section className={styles.panel}>
      <h1 className={styles.answer}>{analysis.reviewed ? 'Your aid documents' : 'Check your extracted fields'}</h1>
      <p>Compare these extracted fields and page references with your original document. AI can misread a file. If anything is wrong, upload a clearer copy before continuing.</p>
      <p>A FAFSA summary is not your school’s final aid offer or bill. Estimates below are not guaranteed awards. Annual and semester amounts are kept separate.</p>
      <ol>{analysis.document.fileNames.map((name, i) => <li key={i}>Document {i + 1}: {name}</li>)}</ol>
    </section>
    {(analysis.summaryFacts ?? []).map(f => <Card key={f.id}>
      <h2>{f.label}{f.estimated ? ' — estimate, not a confirmed award' : ''}</h2>
      <p>{f.value} · {f.period}</p><blockquote>“{f.quote}”</blockquote><p>Document {f.document}, page {f.page}</p>
    </Card>)}
    {!analysis.reviewed && <Card><label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I compared these fields with my documents and they match.</label>
      <div className={styles.panelActions}>
        <button type="button" className={review.confirm} disabled={!checked} onClick={onConfirm}>Confirm these fields</button>
        <button type="button" className={review.restart} onClick={onRestart}>Upload a clearer copy</button>
      </div><p>Your summary stays in this tab. Refreshing clears it; personalized questions expire after one hour.</p>
    </Card>}
    {analysis.reviewed && <>
      <PersonalizedAnswer analysis={analysis} label="Explain my aid in detail" question="Give me a detailed explanation of my uploaded aid documents. Explain what each document says, my SAI if present, grants and scholarships versus loan offers and work-study, estimates versus actual awards, and my statement balance only if explicitly shown. Keep different time periods separate. State what is missing and give me a practical checklist of questions to ask my school. Do not calculate amounts or tell me to accept a specific loan." />
      <Card><a href="/search">Explore related questions</a> · <a href="/ask">Ask a follow-up question</a> · <button type="button" onClick={onRestart}>Upload different documents</button></Card>
    </>}
  </div></FlowShell>;
}
