import { useMemo, useState } from 'react';
import { Amount, Card, Section } from '../ui';
import {
  amountStillOwed,
  evaluateLoan,
  formatDeduction,
  formatUSD,
  LOAN_BANDS,
  LOAN_COPY,
  maxAcceptable,
} from '../../core';
import { DEMO_GRANTS_APPLIED, DEMO_SEMESTER } from '../../data/demo';
import layout from '../../styles/layout.module.css';
import styles from './LoanDecision.module.css';

const TONE_CLASS = {
  green: { box: styles.verdictGreen, head: styles.headGreen },
  gold: { box: styles.verdictGold, head: styles.headGold },
  rust: { box: styles.verdictRust, head: styles.headRust },
} as const;

const GLYPH = { green: '\u2713', gold: '\u25CB', rust: '\u26A0' } as const;

const TRACK_COLOUR = {
  green: 'var(--green)',
  gold: 'var(--gold)',
  rust: 'var(--rust)',
} as const;

/**
 * The loan decision, and the one place the colour system does real work.
 *
 * The verdict comes from `evaluateLoan` in core/ — comparisons and
 * subtraction, run in the browser. No model is involved in deciding what a
 * student should borrow.
 */
export function LoanDecision() {
  const owed = amountStillOwed(DEMO_SEMESTER.bill, DEMO_SEMESTER.grantsApplied);
  const input = {
    owed,
    subsidizedAvailable: DEMO_SEMESTER.subsidizedAvailable,
    unsubsidizedAvailable: DEMO_SEMESTER.unsubsidizedAvailable,
  };
  const ceiling = maxAcceptable(input);

  const [amount, setAmount] = useState(owed);
  const verdict = useMemo(() => evaluateLoan(input, amount), [amount]);

  const grantsTotal = DEMO_GRANTS_APPLIED.reduce((sum, g) => sum + g.amount, 0);
  const filled = (amount / ceiling) * 100;
  const tone = TONE_CLASS[verdict.tone];

  return (
    <Section
      id="loan"
      eyebrow="Loan decision"
      title="The colour is the advice"
      lede="Green is money you keep. Gold is money you repay. Rust is money with nothing covering it. On this screen the verdict moves through all three as you step past what you actually owe — drag the amount and watch it change."
    >
      <div className={layout.split}>
        <Card hero className={styles.panel}>
          <div>
            <div className={styles.billRow}>
              <span className={styles.billLabel}>Your bill this semester</span>
              <Amount value={DEMO_SEMESTER.bill} size={17} column />
            </div>
            <div className={styles.billRow}>
              <span>
                <span className={styles.billLabel}>Grants applied</span>
                <span className={styles.billNote}>
                  {DEMO_GRANTS_APPLIED.map((g) => `${g.label} ${formatUSD(g.amount)}`).join(' + ')}
                </span>
              </span>
              <Amount value={formatDeduction(grantsTotal)} size={17} tone="green" column />
            </div>
            <div className={styles.owed}>
              <span className={styles.billLabel}>You still owe</span>
              <Amount value={owed} size={21} column />
            </div>
          </div>

          <div className={styles.control}>
            <div className={styles.controlHead}>
              <label className={styles.controlLabel} htmlFor="loan-amount">
                How much of the loan to accept
              </label>
              <Amount value={amount} size={21} />
            </div>

            <input
              id="loan-amount"
              className={styles.slider}
              type="range"
              min={0}
              max={ceiling}
              step={50}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
              aria-valuetext={`${formatUSD(amount)}. ${verdict.headline}`}
              style={
                {
                  '--track': `linear-gradient(to right, ${TRACK_COLOUR[verdict.tone]} ${filled}%, var(--sunk) ${filled}%)`,
                } as React.CSSProperties
              }
            />

            <div className={styles.scale}>
              <span>{formatUSD(0)}</span>
              <span>{formatUSD(ceiling)} offered</span>
            </div>
          </div>

          <div className={styles.splitRow}>
            <div className={styles.splitCell}>
              <span className={styles.splitLabel}>Subsidized</span>
              <Amount value={verdict.subsidized} size={17} />
            </div>
            <div className={styles.splitCell}>
              <span className={styles.splitLabel}>Unsubsidized</span>
              <Amount value={verdict.unsubsidized} size={17} />
            </div>
          </div>

          <p className={styles.billNote}>
            Demo figures. These come from your own award once you add it.
          </p>
        </Card>

        <div>
          {/* Not a live region: the slider announces the amount and the verdict
              through its own aria-valuetext as the value changes. */}
          <div className={`${styles.verdict} ${tone.box}`}>
            {/* Every band is rendered on top of the others, so the panel is
                always as tall as the longest wording and never resizes when
                the verdict changes. Only the current one is visible. */}
            <div className={styles.verdictStack}>
              {LOAN_BANDS.map((band) => {
                const copy = LOAN_COPY[band];
                const active = band === verdict.band;
                return (
                  <div
                    key={band}
                    className={styles.verdictLayer}
                    hidden={!active}
                    aria-hidden={!active}
                  >
                    <p className={`${styles.verdictHead} ${TONE_CLASS[copy.tone].head}`}>
                      <span aria-hidden="true">{GLYPH[copy.tone]}</span>
                      {copy.headline}
                    </p>
                    <p className={styles.verdictBody}>{copy.detail}</p>
                  </div>
                );
              })}
            </div>
            <div className={styles.verdictExcess}>
              <span>Borrowed beyond your bill</span>
              <Amount
                value={verdict.excess}
                size={17}
                tone={verdict.excess === 0 ? 'green' : verdict.tone}
                column
              />
            </div>
          </div>

          <div className={layout.points} style={{ marginTop: 'var(--s-32)' }}>
            <div className={layout.point}>
              <h3 className={layout.pointTitle}>You do not have to take all of it</h3>
              <p className={layout.pointBody}>
                Your portal lets you accept part of an offer. Taking the full amount when you owe
                less means borrowing money you did not need, and repaying it with interest.
              </p>
            </div>
            <div className={layout.point}>
              <h3 className={layout.pointTitle}>Subsidized first, and only then the rest</h3>
              <p className={layout.pointBody}>
                The government covers the interest on subsidized loans while you are enrolled at
                least half time. Unsubsidized interest starts the day it disburses.
              </p>
            </div>
            <div className={layout.point}>
              <h3 className={layout.pointTitle}>A refund is still a loan</h3>
              <p className={layout.pointBody}>
                Anything left after your bill is refunded to you, which is genuinely useful for rent
                and food. It is still borrowed, and it is still repaid.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
