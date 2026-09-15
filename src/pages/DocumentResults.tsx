import { useMemo, useState } from 'react';
import type { AidAnalysis } from '../core';
import { documentDashboard, factAmount, type DocumentFact } from '../core/documentDashboard';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { FinancialCard, type MoneyRow } from '../components/FinancialCard/FinancialCard';
import { MissingMetric, MoneyMetric } from '../components/MoneyMetric/MoneyMetric';
import { Card, Pill } from '../components/ui';
import { Aurora } from '../components/fx';
import { PersonalizedAnswer } from '../components/PersonalizedAnswer';
import styles from './BetaResults.module.css';
import review from './SummaryReview.module.css';

function row(f: DocumentFact): MoneyRow {
  return { id: f.id, label: f.label, value: factAmount(f),
    meaning: `${f.period} · ${f.estimated ? 'Estimate, not a confirmed award' : f.field.includes('Loan') ? 'Loan offer, not confirmed borrowing' : f.field === 'workStudyOffer' ? 'Work opportunity, not an upfront payment' : 'As printed in your document'} · document ${f.document}, page ${f.page}`,
    tone: f.estimated ? 'muted' : ['grantOffer', 'scholarshipOffer'].includes(f.field) ? 'green' : 'gold',
  };
}

export function DocumentResults({ analysis, onConfirm, onRestart }: { analysis: AidAnalysis; onConfirm: () => void; onRestart: () => void }) {
  const dashboard = useMemo(() => documentDashboard(analysis.summaryFacts ?? []), [analysis]);
  const [checked, setChecked] = useState(false);
  const { gifts, loans, balance, sai } = dashboard;
  const metric = (groups: typeof gifts, label: string, loan: boolean) => groups.length === 1
    ? <MoneyMetric label={label} value={groups[0].amount} tone={loan ? 'gold' : 'green'} status={{ tone: loan ? 'gold' : 'green', text: 'Listed offers' }} note={`${groups[0].period}. ${loan ? 'Listed loan offers; acceptance and payment are not confirmed.' : 'Listed grants and scholarships; confirm award conditions with your school.'} Only extracted lines are included.`} />
    : groups.length > 1 ? <><h2 className={styles.cardTitle}>{label}</h2><FinancialCard rows={groups.map((g, i) => ({ id: String(i), label: g.period, value: g.amount, meaning: 'Listed offers only', tone: loan ? 'gold' : 'green' }))} /><p className={styles.cardLede}>Separate periods are not added together.</p></>
    : <MissingMetric label={label} prompt="Not stated in a school offer" explanation="Add your award letter. FAFSA estimates are shown separately below and are not counted as confirmed offers." />;
  const steps = [
    { title: analysis.reviewed ? 'Keep your source documents with this result' : 'Check your figures against the originals', why: 'AI can misread a document. Use the page references below to check each extracted figure.', action: analysis.reviewed ? 'You confirmed the extracted fields. Re-upload if your school issues updated documents.' : 'Open “Check the figures and document references” below, compare the values and confirm they match.' },
    ...(balance ? [{ title: balance.field === 'creditBalance' ? 'Confirm what happens to your credit balance' : 'Check your current balance with your school', why: `Your statement lists ${balance.value} for ${balance.period}. Offers may not yet be posted.`, action: 'Ask which aid has been applied, which items remain pending, and what payment or refund timing the school has confirmed.' }] : [{ title: 'Add your student account statement', why: 'An aid offer or FAFSA estimate does not show what your school is currently asking you to pay.', action: 'Download a current statement showing charges, applied payments and the remaining balance.' }]),
    ...(loans.length ? [{ title: 'Review loan terms before deciding what to accept', why: 'An offered loan is not a payment already made to your school.', action: 'Ask your aid office to explain the offer, requirements and your full costs before making a borrowing decision.' }] : []),
    ...(dashboard.estimates.length ? [{ title: 'Confirm estimated aid with your school', why: 'Your FAFSA estimates are separate from the school’s final award.', action: 'Compare the estimate with your school award letter and ask whether any eligibility review or documents remain outstanding.' }] : []),
  ];
  return <FlowShell step={3}>
    <section className={`${styles.panel} ${styles.gold}`} aria-labelledby="answer">
      <div className={styles.glow} aria-hidden="true"><Aurora tone="dark" /></div>
      <span className={styles.eyebrow}>Your answer</span>
      <h1 id="answer" className={styles.answer}>{dashboard.headline}</h1>
      <p className={styles.detail}>{dashboard.detail}</p>
      <div className={styles.source}><p className={styles.sourceText}>Read from {analysis.document.fileNames.join(', ')} · {new Date(analysis.document.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p><Pill tone={analysis.reviewed ? 'green' : 'gold'}>{analysis.reviewed ? 'Fields reviewed' : 'Check extracted figures'}</Pill></div>
      <div className={styles.panelActions}><button className={styles.print} onClick={() => window.print()}>Save or print this</button><button className={styles.again} onClick={onRestart}>Upload a different document</button></div>
    </section>
    {!analysis.reviewed && <p className={styles.warn}>Check the extracted figures against your originals below. This explanation is based on an AI read and may contain errors.</p>}
    <ul className={styles.metrics}>
      <Card as="li">{metric(gifts, 'Money you keep', false)}</Card>
      <Card as="li">{metric(loans, 'Money you repay', true)}</Card>
      <Card as="li">{balance ? <MoneyMetric label={balance.field === 'creditBalance' ? 'Credit balance shown' : 'Still owed to your school'} value={factAmount(balance)} tone={balance.field === 'creditBalance' || factAmount(balance) === 0 ? 'green' : 'rust'} status={{ tone: 'gold', text: 'Statement figure' }} note={`${balance.period}. This is the printed balance, not an estimate after future aid.`} /> : <MissingMetric label="Still owed to your school" prompt={dashboard.balances.length ? 'More than one balance shown' : 'No statement balance found'} explanation="See individual statement figures below. A single current balance cannot be inferred from offers or estimates." />}</Card>
    </ul>
    <div className={styles.split}>
      <div className={styles.column}>
        <Card hero><h2 className={styles.cardTitle}>Your award, line by line</h2><p className={styles.cardLede}>The lines read from your documents, with estimates and time periods kept separate.</p>{dashboard.awardFacts.length ? <FinancialCard rows={dashboard.awardFacts.map(row)} footnote="An offer is not proof of acceptance or disbursement. Work-study is excluded from the grant and loan totals." /> : <MissingMetric label="Aid offers" prompt="No award lines found" explanation="Upload your school’s award letter to see its grant, scholarship and loan offers here." />}</Card>
        <Card hero><h2 className={styles.cardTitle}>What your school is actually asking for</h2>{dashboard.billFacts.length ? <FinancialCard rows={dashboard.billFacts.map(row)} footnote="Payments applied may include different payment sources. They are not automatically classified as grants. No pending award is subtracted again." /> : <MissingMetric label="Your school bill" prompt="No account statement figures found" explanation="Add your student account statement to see its charges, applied payments and stated balance here." />}</Card>
      </div>
      <div className={styles.column}>
        <Card><h2 className={styles.cardTitle}>Your Student Aid Index</h2>{sai ? <><span className={styles.sai}>{factAmount(sai).toLocaleString('en-US')}</span><p className={styles.cardLede}>{sai.period} · document {sai.document}, page {sai.page}</p><p className={styles.saiFoot}>This is the SAI printed on your document. It is used in financial aid calculations; it is not a bill, award or refund amount.</p></> : <MissingMetric label="Student Aid Index" prompt="No single SAI confirmed" explanation="Check the source fields below or add your FAFSA Submission Summary." />}</Card>
        {dashboard.missing.length > 0 && <Card><h2 className={styles.cardTitle}>What Fynliq could not read</h2><p className={styles.cardLede}>These details are not established by the extracted fields. Missing amounts are not treated as zero.</p><ul className={styles.unread}>{dashboard.missing.map(text => <li className={styles.unreadItem} key={text}><span className={styles.unreadField}>{text}</span></li>)}</ul></Card>}
        <Card><h2 className={styles.cardTitle}>The words on your document</h2><div className={styles.glossary}>{[['Offer', 'An amount your school lists as available, subject to its conditions. It is not proof the money has been accepted or paid.'], ['Estimate', 'A preliminary figure. Your school must confirm the final award and when it applies.'], ['Statement balance', 'The amount printed on your account statement for its stated period. Later payments or adjustments may change it.']].map(([term, body]) => <details className={styles.term} key={term}><summary className={styles.summary}>{term}<span className={styles.sign}>+</span></summary><p className={styles.answerBody}>{body}</p></details>)}</div></Card>
      </div>
    </div>
    <section className={styles.next} aria-labelledby="next-title"><h2 id="next-title" className={styles.nextTitle}>What to do next</h2><p className={styles.nextLede}>Next steps based on what your uploaded documents show and what is still missing.</p><ol className={styles.steps}>{steps.map((step, i) => <Card as="li" key={step.title} className={styles.step}><span className={styles.stepIndex}>{String(i + 1).padStart(2, '0')}</span><div className={styles.stepBody}><h3 className={styles.stepTitle}>{step.title}</h3><p className={styles.stepWhy}>{step.why}</p><p className={styles.stepAction}>{step.action}</p></div></Card>)}</ol></section>
    <Card><details><summary className={styles.summary}>Check the figures and document references</summary><ol>{analysis.document.fileNames.map((name, i) => <li key={i}>Document {i + 1}: {name}</li>)}</ol><div className={review.layout}>{dashboard.facts.map(f => <div key={f.id}><h3>{f.label}: {f.value}</h3><p>{f.period} · document {f.document}, page {f.page}{f.estimated ? ' · estimate' : ''}</p><blockquote>“{f.quote}”</blockquote></div>)}</div></details>{!analysis.reviewed && <div className={styles.panelActions}><label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I compared the extracted fields with my documents and they match.</label><button className={review.confirm} disabled={!checked} onClick={onConfirm}>Confirm these fields</button></div>}<p className={styles.cardLede}>Your document read stays in this tab. Refreshing clears it; personalized follow-up questions expire after one hour.</p></Card>
    {analysis.reviewed && <PersonalizedAnswer analysis={analysis} label="Explain these details further" question="Explain my reviewed aid documents in more detail, keeping estimates, school offers and statement figures separate. Explain missing details and questions for my school without inventing amounts or dates." />}
  </FlowShell>;
}
