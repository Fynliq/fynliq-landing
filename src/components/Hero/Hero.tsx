import { Amount, Button } from '../ui';
import { Aurora, Depth, Stage3D } from '../fx';
import { HomeScreen } from '../ProductPreview';
import { breakDownAward, computeRunway, formatUSD } from '../../core';
import { DEMO_AWARD, DEMO_RUNWAY } from '../../data/demo';
import styles from './Hero.module.css';

const TITLE = 'Know what your aid actually leaves you.';
const WORDS = TITLE.split(' ');

export function Hero() {
  const aid = breakDownAward(DEMO_AWARD);
  const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);

  return (
    <section className={styles.hero} id="top" aria-labelledby="hero-title">
      <div className={styles.backdrop} aria-hidden="true">
        <Aurora className={styles.heroAurora} />
        <span className={styles.grid} />
      </div>

      <div className={styles.inner}>
        <div className={styles.copy}>
          <span className={styles.tag}>
            <span className={styles.pulse} aria-hidden="true" />
            Fynliq &middot; Beta
          </span>

          {/* The words animate in one by one, so the heading is read from a
              single label rather than from 7 separate fragments. */}
          <h1 id="hero-title" className={styles.title} aria-label={TITLE}>
            <span aria-hidden="true">
              {WORDS.map((word, i) => (
                <span key={i} className={styles.word} style={{ '--i': i } as React.CSSProperties}>
                  <span className={styles.wordIn}>{word}</span>
                </span>
              ))}
            </span>
          </h1>

          <p className={styles.lede}>
            Your award letter lists four numbers and explains none of them. Fynliq reads your own
            award and shows what you keep, what you repay, what nothing is covering, and how long
            the money in your account has to last.
          </p>

          <div className={styles.actions}>
            <Button href="#join" arrow>
              Join the beta
            </Button>
            <Button href="#clarity" variant="secondary">
              See how it works
            </Button>
          </div>

          <p className={styles.assurance}>
            Educational guidance only. Fynliq is not affiliated with FAFSA, Federal Student Aid, the
            Department of Education, or your school.
          </p>
        </div>

        <Stage3D className={styles.stage} max={7} restX={2} restY={-9}>
          <Depth z={0} delay={0} className={styles.phoneLayer}>
            <div className={styles.phoneGlow} aria-hidden="true" />
            <HomeScreen />
          </Depth>

          {/* Both chips carry figures the maths already produced, floating in
              front of the screen they came from. */}
          {runway.status === 'ready' && (
            <>
              <Depth z={110} delay={-2400} className={`${styles.chip} ${styles.chipWeekly}`}>
                <span className={styles.chipLabel}>Safe weekly</span>
                <Amount value={runway.safeWeekly} size={21} />
              </Depth>

              <Depth z={82} delay={-5200} className={`${styles.chip} ${styles.chipDays}`}>
                <span className={styles.chipLabel}>Runway</span>
                <span className={styles.chipDays_value}>{runway.daysRemaining} days</span>
              </Depth>
            </>
          )}

          <Depth z={-140} delay={-1200} className={styles.slab} />
        </Stage3D>

        <ul className={styles.facts}>
          <li className={styles.fact}>
            <Amount value={aid.giftAid} size={25} tone="green" countUp />
            <span className={styles.factLabel}>
              of this demo award is gift aid &mdash; money kept, never repaid
            </span>
          </li>
          <li className={styles.fact}>
            <Amount value={aid.loansOffered} size={25} tone="gold" countUp />
            <span className={styles.factLabel}>
              is offered as loans, which you can accept in part or decline
            </span>
          </li>
          <li className={styles.fact}>
            <Amount value={aid.uncovered ?? 0} size={25} tone="rust" countUp />
            <span className={styles.factLabel}>
              has nothing covering it &mdash; the gap worth acting on first
            </span>
          </li>
        </ul>

        {runway.status === 'ready' && (
          <p className="srOnly">
            The preview shows a demo student with {runway.daysRemaining} days until their next
            disbursement and a safe weekly figure of {formatUSD(runway.safeWeekly)}.
          </p>
        )}
      </div>
    </section>
  );
}
