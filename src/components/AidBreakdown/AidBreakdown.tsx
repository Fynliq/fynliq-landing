import { Amount, Bar, Card, Pill, Section } from '../ui';
import { FinancialCard } from '../FinancialCard/FinancialCard';
import type { MoneyRow } from '../FinancialCard/FinancialCard';
import { breakDownAward, formatUSD } from '../../core';
import { DEMO_AWARD } from '../../data/demo';
import layout from '../../styles/layout.module.css';
import styles from './AidBreakdown.module.css';

const ENROLMENT = [
  {
    label: 'Your award assumes',
    note: 'Full-time, 12+ credit hours',
    pill: { tone: 'green' as const, text: '12+ hrs' },
  },
  {
    label: 'Drop below 12 hours',
    note: 'Pell is reduced proportionally',
    pill: { tone: 'gold' as const, text: 'Less Pell' },
  },
  {
    label: 'Drop below 6 hours',
    note: 'Most aid stops entirely',
    pill: { tone: 'rust' as const, text: 'Aid stops' },
  },
];

const GLOSSARY = [
  {
    term: 'Undergrad institutional grant',
    body: "Your school's own money, given by them rather than the government. You don't repay it. Usually based on need, merit, or both, and the school sets the amount.",
  },
  {
    term: 'Student Aid Index (SAI)',
    body: "A number FAFSA works out from your family's finances. Schools subtract it from the cost of attendance to find your need. Lower SAI means more aid. It replaced the old EFC and can go negative, which qualifies you for maximum Pell.",
  },
  {
    term: 'Verification',
    body: 'A check where your school asks you to confirm what you put on your FAFSA, usually with tax documents. Being selected does not mean you did anything wrong — a share of students are picked at random. Your aid will not disburse until it is finished.',
  },
  {
    term: 'Cost of attendance',
    body: "Your school's estimate of the full year — tuition, housing, food, books, transport. It is higher than tuition on purpose, because it sets the ceiling on how much aid you are allowed to receive.",
  },
];

export function AidBreakdown() {
  const aid = breakDownAward(DEMO_AWARD);

  const rows: MoneyRow[] = DEMO_AWARD.lines
    .filter((line) => line.kind !== 'work-study')
    .map((line) => ({
      id: line.id,
      label: line.label,
      meaning: line.meaning,
      value: line.amount,
      tone: line.kind === 'grant' ? ('green' as const) : ('gold' as const),
    }));

  const workStudy = DEMO_AWARD.lines.find((line) => line.kind === 'work-study');

  return (
    <Section
      id="aid"
      eyebrow="Financial aid"
      title="Your award, line by line and in plain English"
      lede="An award letter gives you four rows and a total. Fynliq splits the same rows into money you keep and money you repay, then explains the words the letter never defines."
      sunk
    >
      <div className={layout.split}>
        <div className={styles.stack}>
          <Card hero>
            <span className="srOnly">
              Demo award for {DEMO_AWARD.year}, read from a {DEMO_AWARD.source}.
            </span>
            <FinancialCard
              rows={rows}
              total={{ label: 'Total offered', value: aid.offered }}
              footnote={
                <>
                  Only <strong>{formatUSD(aid.giftAid)}</strong> of that is money you keep. The other{' '}
                  <strong>{formatUSD(aid.loansOffered)}</strong> is borrowed, and it is an offer you
                  can decline in part or in full.
                </>
              }
            />

            <Bar
              caption={`Of ${formatUSD(aid.offered)} offered: ${formatUSD(aid.giftAid)} kept, ${formatUSD(aid.loansOffered)} repaid, and ${formatUSD(aid.uncovered ?? 0)} with nothing covering it.`}
              segments={[
                { label: `Kept ${formatUSD(aid.giftAid)}`, value: aid.giftAid, tone: 'green' },
                { label: `Repaid ${formatUSD(aid.loansOffered)}`, value: aid.loansOffered, tone: 'gold' },
                { label: `Uncovered ${formatUSD(aid.uncovered ?? 0)}`, value: aid.uncovered ?? 0, tone: 'rust' },
              ]}
            />
          </Card>

          {workStudy && (
            <Card>
              <div className={styles.enrolRow}>
                <span>
                  <span className={styles.enrolLabel}>{workStudy.label}</span>
                  <span className={styles.enrolNote}>
                    Offered, but kept out of your runway. {workStudy.meaning}.
                  </span>
                </span>
                <Amount value={workStudy.amount} size={17} tone="muted" column />
              </div>
            </Card>
          )}
        </div>

        <div className={styles.stack}>
          <Card>
            <h3 className={styles.groupTitle}>Your enrolment changes your aid</h3>
            <div className={styles.enrolment}>
              {ENROLMENT.map((row) => (
                <div key={row.label} className={styles.enrolRow}>
                  <span>
                    <span className={styles.enrolLabel}>{row.label}</span>
                    <span className={styles.enrolNote}>{row.note}</span>
                  </span>
                  <Pill tone={row.pill.tone}>{row.pill.text}</Pill>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className={styles.groupTitle}>Words on your award</h3>
            <div className={styles.glossary}>
              {GLOSSARY.map((entry) => (
                <details key={entry.term} className={styles.term}>
                  <summary className={styles.summary}>
                    {entry.term}
                    <span className={styles.sign} aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className={styles.answer}>{entry.body}</p>
                </details>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
