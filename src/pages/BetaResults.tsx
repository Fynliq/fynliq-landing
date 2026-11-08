import { useMemo, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { FinancialCard, type MoneyRow } from '../components/FinancialCard/FinancialCard';
import { MissingMetric, MoneyMetric } from '../components/MoneyMetric/MoneyMetric';
import { Amount, Bar, Card, Pill } from '../components/ui';
import { Aurora } from '../components/fx';
import {
  CONFIDENCE_FLOOR,
  DOCUMENT_LABEL,
  analyseOutcome,
  buildNextSteps,
  formatDeduction,
  formatUSD,
  type AidAnalysis,
} from '../core';
import { PersonalizedAnswer } from '../components/PersonalizedAnswer';
import styles from './BetaResults.module.css';
import review from './SummaryReview.module.css';

interface BetaResultsProps {
  analysis: AidAnalysis;
  /** Clears the result and returns to the upload step. */
  onRestart: () => void;
  /** Marks the read figures as checked by the student (document reads only). */
  onConfirm?: () => void;
}

const readDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function confidenceReading(confidence: number) {
  if (confidence >= 0.9) return { tone: 'green' as const, text: 'Read cleanly' };
  if (confidence >= CONFIDENCE_FLOOR) return { tone: 'gold' as const, text: 'Worth a check' };
  return { tone: 'rust' as const, text: 'Hard to read' };
}

/**
 * The words on a student's own documents, defined only where they appear.
 *
 * A glossary that lists every term in financial aid is a reference book. This
 * one lists the terms on the page they just uploaded, which is the only
 * reason any of them matter today.
 */
const GLOSSARY: { term: string; body: string; applies: (a: AidAnalysis) => boolean }[] = [
  {
    term: 'Student Aid Index (SAI)',
    body: "A number the FAFSA formula works out from your family's finances. Your school subtracts it from the cost of attendance to find your need, and draws aid against that. Lower means more need. It replaced the old EFC, and it can go negative.",
    applies: () => true,
  },
  {
    term: 'Gift aid',
    body: 'Grants and scholarships — money given to you. You do not repay it, and it is the part of an offer worth protecting when your enrolment or your circumstances change.',
    applies: (a) => a.award.lines.some((line) => line.kind === 'grant'),
  },
  {
    term: 'Subsidized loan',
    body: 'Borrowed money the government pays the interest on while you are enrolled at least half time. It is the cheapest borrowing in a federal offer, which is why it is worth accepting before any unsubsidized loan.',
    applies: (a) => a.award.lines.some((line) => line.kind === 'subsidized-loan'),
  },
  {
    term: 'Unsubsidized loan',
    body: 'Borrowed money that charges interest from the day it disburses, including while you study. Take it after the subsidized money, and only up to what you actually owe.',
    applies: (a) => a.award.lines.some((line) => line.kind === 'unsubsidized-loan'),
  },
  {
    term: 'Federal work-study',
    body: 'A pot of money set aside to pay you wages for hours worked in an eligible job. It is not a lump sum and it is not applied to your bill — hours you do not work are simply not paid.',
    applies: (a) => a.award.lines.some((line) => line.kind === 'work-study'),
  },
  {
    term: 'Cost of attendance',
    body: "Your school's estimate of a full year — tuition, housing, food, books, transport. It is deliberately higher than tuition, because it sets the ceiling on how much aid you are allowed to receive.",
    applies: (a) => a.award.costOfAttendance !== null,
  },
  {
    term: 'Disbursement',
    body: 'The day aid money actually reaches your student account. Your bill is paid from it first; anything left over is refunded to you, and that refund is what has to last until the next one.',
    applies: () => true,
  },
];

export function BetaResults({ analysis, onRestart, onConfirm }: BetaResultsProps) {
  const outcome = useMemo(() => analyseOutcome(analysis), [analysis]);
  const steps = useMemo(() => buildNextSteps(analysis, outcome), [analysis, outcome]);

  const { aid, balance, sai, headline } = outcome;
  const confidence = confidenceReading(analysis.document.confidence);
  const glossary = GLOSSARY.filter((entry) => entry.applies(analysis));

  const awardRows: MoneyRow[] = analysis.award.lines
    .filter((line) => line.kind !== 'work-study')
    .map((line) => ({
      id: line.id,
      label: line.label,
      meaning: line.meaning,
      value: line.amount,
      tone: line.kind === 'grant' ? 'green' : 'gold',
    }));

  const workStudy = analysis.award.lines.find((line) => line.kind === 'work-study');
  const estimate = analysis.estimatesOnly === true;
  const noOffer = aid.offered === 0;
  const [checked, setChecked] = useState(false);
  const facts = analysis.summaryFacts ?? [];

  return (
    <FlowShell step={3}>
      {analysis.provenance === 'demo' && (
        <p className={styles.demo}>
          <span className={styles.demoTag}>Preview</span>
          The document reader is not connected yet, so the figures below are Fynliq&rsquo;s demo
          student &mdash; not the figures in the file you just uploaded. Every layout, calculation
          and next step on this page is the real one, running on real code.
        </p>
      )}

      {/* The answer, stated before anything that supports it. */}
      <section className={`${styles.panel} ${styles[headline.tone]}`} aria-labelledby="answer">
        <div className={styles.glow} aria-hidden="true">
          <Aurora tone="dark" />
        </div>

        <span className={styles.eyebrow}>Your answer</span>
        <h1 id="answer" className={styles.answer}>
          {headline.sentence}
        </h1>
        <p className={styles.detail}>{headline.detail}</p>

        <div className={styles.source}>
          <p className={styles.sourceText}>
            Read from {analysis.document.fileNames.join(', ') || 'your upload'} &middot;{' '}
            {DOCUMENT_LABEL[analysis.document.kind]} &middot;{' '}
            {readDate.format(new Date(analysis.document.readAt))}
            {analysis.student.school && <> &middot; {analysis.student.school}</>}
          </p>
          <Pill tone={confidence.tone}>{confidence.text}</Pill>
        </div>

        <div className={styles.panelActions}>
          <button type="button" className={styles.print} onClick={() => window.print()}>
            Save or print this
          </button>
          <button type="button" className={styles.again} onClick={onRestart}>
            Upload a different document
          </button>
        </div>
      </section>

      {outcome.needsChecking && (
        <p className={styles.warn}>
          <span aria-hidden="true">⚠</span> Parts of this document were hard to read. Check the
          figures below against your school portal before you act on them.
        </p>
      )}

      {/* ---- The three figures every award comes down to ---------------- */}
      <ul className={styles.metrics}>
        <Card as="li">
          {noOffer ? (
            <MissingMetric
              label="Money you keep"
              prompt="No aid offer in what you uploaded"
              explanation="Add a screenshot of your school portal's Accept/Decline page or your award letter to see your grants and scholarships here."
            />
          ) : (
            <MoneyMetric
              label="Money you keep"
              value={aid.giftAid}
              tone="green"
              status={estimate ? { tone: 'gold', text: 'Estimate' } : { tone: 'green', text: 'Never repaid' }}
              note={estimate
                ? 'Grants on your FAFSA estimate. Never repaid, but your school confirms the final amount.'
                : 'Grants and scholarships. This is the part of your offer that costs you nothing.'}
            />
          )}
        </Card>
        <Card as="li">
          {noOffer ? (
            <MissingMetric
              label="Money you repay"
              prompt="No loan offer in what you uploaded"
              explanation="Loans show here once your school's offer is uploaded."
            />
          ) : (
            <MoneyMetric
              label="Money you repay"
              value={aid.loansOffered}
              tone="gold"
              status={{ tone: 'gold', text: estimate ? 'Estimate' : 'An offer' }}
              note={estimate
                ? 'Federal loans your FAFSA estimate says you may borrow. Borrowing is optional.'
                : 'Loans you were offered. You can accept part of this, or none of it.'}
            />
          )}
        </Card>
        <Card as="li">
          {aid.uncovered === null ? (
            <MissingMetric
              label="Not covered"
              prompt="Cost of attendance not stated"
              explanation="Your document did not give a cost of attendance, so Fynliq will not estimate the gap. Your school publishes the figure for your programme."
            />
          ) : (
            <MoneyMetric
              label="Nothing is covering"
              value={aid.uncovered}
              tone={aid.uncovered > 0 ? 'rust' : 'green'}
              status={
                aid.uncovered > 0
                  ? { tone: 'rust', text: 'Act on this' }
                  : { tone: 'green', text: 'Fully covered' }
              }
              note={
                aid.uncovered > 0
                  ? `Your year costs ${formatUSD(analysis.award.costOfAttendance ?? 0)} and you were offered ${formatUSD(aid.offered)}.`
                  : 'Everything your school counts as the cost of your year is covered by the offer.'
              }
            />
          )}
        </Card>
      </ul>

      <div className={styles.split}>
        <div className={styles.column}>
          {/* ---- The award, line by line ------------------------------- */}
          <Card hero>
            <h2 className={styles.cardTitle}>Your award, line by line</h2>
            {noOffer ? (
              <MissingMetric
                label="Aid offer"
                prompt="No award lines found"
                explanation="Upload your school portal's Accept/Decline page or your award letter. If the table scrolls sideways, upload both screenshots together."
              />
            ) : (
            <>
            <p className={styles.cardLede}>
              {estimate
                ? <>The estimates on your FAFSA results, split into money you keep and money you would repay, for {analysis.award.year}.</>
                : <>The same rows as your letter, split into money you keep and money you repay, for {analysis.award.year}.</>}
            </p>

            <FinancialCard
              rows={awardRows}
              total={{ label: estimate ? 'Total estimated' : 'Total offered', value: aid.offered }}
              footnote={estimate ? (
                <>
                  These are federal estimates, not your school&rsquo;s offer. Your school&rsquo;s
                  award letter or portal confirms what you are actually offered.
                </>
              ) : (
                <>
                  Only <strong>{formatUSD(aid.giftAid)}</strong> of that is money you keep. The
                  other <strong>{formatUSD(aid.loansOffered)}</strong> is borrowed, and it is an
                  offer you can decline in part or in full.
                </>
              )}
            />

            <Bar
              caption={`Of ${formatUSD(aid.offered)} offered: ${formatUSD(aid.giftAid)} kept, ${formatUSD(aid.loansOffered)} repaid${aid.uncovered === null ? '' : `, and ${formatUSD(aid.uncovered)} with nothing covering it`}.`}
              segments={[
                { label: `Kept ${formatUSD(aid.giftAid)}`, value: aid.giftAid, tone: 'green' },
                {
                  label: `Repaid ${formatUSD(aid.loansOffered)}`,
                  value: aid.loansOffered,
                  tone: 'gold',
                },
                ...(aid.uncovered !== null && aid.uncovered > 0
                  ? [
                      {
                        label: `Uncovered ${formatUSD(aid.uncovered)}`,
                        value: aid.uncovered,
                        tone: 'rust' as const,
                      },
                    ]
                  : []),
              ]}
            />

            {workStudy && (
              <div className={styles.aside}>
                <span>
                  <span className={styles.asideLabel}>{workStudy.label}</span>
                  <span className={styles.asideNote}>
                    Offered, but kept out of every total above. {workStudy.meaning}.
                  </span>
                </span>
                <Amount value={workStudy.amount} size={17} tone="muted" column />
              </div>
            )}

            {(analysis.estimateLines ?? []).map((line) => (
              <div className={styles.aside} key={line.id}>
                <span>
                  <span className={styles.asideLabel}>{line.label} (FAFSA estimate)</span>
                  <span className={styles.asideNote}>
                    Shown for comparison and kept out of every total above. {line.meaning}.
                  </span>
                </span>
                <Amount value={line.amount} size={17} tone="muted" column />
              </div>
            ))}
            </>
            )}
          </Card>

          {/* ---- This term's bill -------------------------------------- */}
          <Card hero>
            <h2 className={styles.cardTitle}>What your school is actually asking for</h2>

            {balance === null ? (
              <MissingMetric
                label="This term's balance"
                prompt="No bill found in what you uploaded"
                explanation="Add your student account statement and Fynliq can tell you whether this offer clears the term, and exactly how much of your loans to accept."
              />
            ) : (
              <>
                <FinancialCard
                  rows={[
                    {
                      id: 'bill',
                      label: 'This term’s bill',
                      meaning: 'What the school is charging you',
                      value: balance.bill,
                    },
                    {
                      id: 'grants',
                      label: 'Gift aid applied',
                      meaning: 'Already paid against the bill, never repaid',
                      value: formatDeduction(balance.grantsApplied),
                      tone: 'green',
                    },
                  ]}
                  total={{
                    label: 'Still owed to your school',
                    value: balance.stillOwed,
                    tone: balance.stillOwed > 0 ? 'gold' : 'green',
                  }}
                />

                {balance.stillOwed > 0 && balance.loansAvailable > 0 && (
                  <div className={styles.ceiling}>
                    <div className={styles.ceilingTop}>
                      <span className={styles.ceilingLabel}>Accept up to</span>
                      <Pill tone="green">Stop here</Pill>
                    </div>
                    {/* No count-up anywhere on this page. The figure starts at
                        zero and waits to be scrolled into view, which means a
                        print — or anything below the fold — renders $0 for an
                        amount somebody is about to act on. */}
                    <Amount
                      value={Math.min(balance.stillOwed, balance.loansAvailable)}
                      size={32}
                    />
                    <p className={styles.ceilingBody}>
                      {balance.ceiling.subsidized > 0 && (
                        <>
                          <strong>{formatUSD(balance.ceiling.subsidized)}</strong> of that is
                          subsidized, so no interest builds while you are enrolled at least half
                          time.{' '}
                        </>
                      )}
                      {balance.ceiling.unsubsidized > 0 && (
                        <>
                          <strong>{formatUSD(balance.ceiling.unsubsidized)}</strong> is
                          unsubsidized, which charges interest from the day it disburses.{' '}
                        </>
                      )}
                      {balance.loansAvailable > balance.stillOwed && (
                        <>
                          You were offered {formatUSD(balance.loansAvailable)} in total &mdash; the
                          extra {formatUSD(balance.loansAvailable - balance.stillOwed)} is money you
                          would repay without owing it.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {balance.afterAllLoans > 0 && (
                  <div className={styles.gap}>
                    <div className={styles.ceilingTop}>
                      <span className={styles.ceilingLabel}>Still short after every loan</span>
                      <Pill tone="rust">Act on this</Pill>
                    </div>
                    <Amount value={balance.afterAllLoans} size={32} tone="rust" />
                    <p className={styles.ceilingBody}>
                      Accepting all {formatUSD(balance.loansAvailable)} of the loans offered this
                      term still leaves this much of the bill unpaid. Your aid office is the first
                      call, not a private lender.
                    </p>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <div className={styles.column}>
          {/* ---- SAI --------------------------------------------------- */}
          <Card>
            <h2 className={styles.cardTitle}>Your Student Aid Index</h2>
            {sai.value === null ? (
              <MissingMetric
                label="Student Aid Index"
                prompt="Not stated on what you uploaded"
                explanation={sai.meaning}
              />
            ) : (
              <>
                <span className={styles.sai}>{sai.value.toLocaleString('en-US')}</span>
                <p className={styles.cardLede}>{sai.meaning}</p>
              </>
            )}
            <p className={styles.saiFoot}>
              Your school works out your need as its cost of attendance minus your SAI minus the
              aid you already have. Fynliq does not set that figure and cannot change it &mdash;
              your aid office can explain how yours was applied.
            </p>
          </Card>

          {/* ---- What could not be read -------------------------------- */}
          {analysis.unread.length > 0 && (
            <Card>
              <h2 className={styles.cardTitle}>What Fynliq could not read</h2>
              <p className={styles.cardLede}>
                These were not stated on what you uploaded. They are left blank rather than
                estimated.
              </p>
              <ul className={styles.unread}>
                {analysis.unread.map((entry) => (
                  <li key={entry.field} className={styles.unreadItem}>
                    <span className={styles.unreadField}>{entry.field}</span>
                    <span className={styles.unreadWhere}>{entry.where}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ---- Glossary ---------------------------------------------- */}
          <Card>
            <h2 className={styles.cardTitle}>The words on your document</h2>
            <div className={styles.glossary}>
              {glossary.map((entry) => (
                <details key={entry.term} className={styles.term}>
                  <summary className={styles.summary}>
                    {entry.term}
                    <span className={styles.sign} aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className={styles.answerBody}>{entry.body}</p>
                </details>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ---- What to do next --------------------------------------------- */}
      <section className={styles.next} aria-labelledby="next-title">
        <h2 id="next-title" className={styles.nextTitle}>
          What to do next
        </h2>
        <p className={styles.nextLede}>
          Ordered by what it costs to skip it. Every step below was produced from your own figures.
        </p>

        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <Card as="li" key={step.id} className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className={styles.stepBody}>
                <div className={styles.stepTop}>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <Pill tone={step.urgency === 'low' ? 'neutral' : step.urgency}>
                    {step.urgency === 'rust'
                      ? 'Do this first'
                      : step.urgency === 'gold'
                        ? 'Worth doing'
                        : 'Keep in mind'}
                  </Pill>
                </div>
                <p className={styles.stepWhy}>{step.why}</p>
                <p className={styles.stepAction}>{step.action}</p>
              </div>
            </Card>
          ))}
        </ol>
      </section>

      {facts.length > 0 && (
        <Card>
          <details>
            <summary className={styles.summary}>Check the figures and where they came from</summary>
            <ol>
              {analysis.document.fileNames.map((name, i) => (
                <li key={i}>Document {i + 1}: {name}</li>
              ))}
            </ol>
            <div className={review.layout}>
              {facts.map((f) => (
                <div key={f.id}>
                  <h3>{f.label}: {f.value}</h3>
                  <p>
                    {f.period === 'Not stated' ? 'Period not stated' : f.period} &middot; document {f.document}, page {f.page}
                    {f.estimated ? ' · estimate' : ''}
                  </p>
                  <blockquote>&ldquo;{f.quote}&rdquo;</blockquote>
                </div>
              ))}
            </div>
          </details>
          {!analysis.reviewed && onConfirm && (
            <div className={styles.panelActions}>
              <label>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I compared
                these figures with my documents and they match.
              </label>
              <button type="button" className={review.confirm} disabled={!checked} onClick={onConfirm}>
                Confirm these figures
              </button>
            </div>
          )}
          <p className={styles.cardLede}>
            Your document read stays in this tab. Refreshing clears it; personalized follow-up questions expire after one hour.
          </p>
        </Card>
      )}
      {facts.length > 0 && analysis.reviewed && (
        <PersonalizedAnswer
          analysis={analysis}
          label="Explain these details further"
          question="Explain my reviewed aid documents in more detail, keeping estimates, school offers and statement figures separate. Explain missing details and questions for my school without inventing amounts or dates."
        />
      )}
    </FlowShell>
  );
}
