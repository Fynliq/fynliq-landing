import { Card, Section } from '../ui';
import { MissingMetric, MoneyMetric } from '../MoneyMetric/MoneyMetric';
import { computeRunway } from '../../core';
import { DEMO_AWARD, DEMO_RUNWAY, DEMO_RUNWAY_NO_DATE } from '../../data/demo';
import layout from '../../styles/layout.module.css';
import styles from './MoneyClarity.module.css';

/**
 * Money clarity: the runway, the weekly figure, and what happens when the
 * date it depends on is missing. Both states are rendered by the same
 * calculation, so the honest one is not a mock-up.
 */
export function MoneyClarity() {
  const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
  const withoutDate = computeRunway(DEMO_RUNWAY_NO_DATE, DEMO_AWARD, true);

  return (
    <Section
      id="clarity"
      eyebrow="Money clarity"
      title="How long the money in your account actually lasts"
      lede="Not a budget you have to keep. One figure for what is left, one for how long it has to stretch, and a weekly number worked out from the two."
    >
      <div className={layout.split}>
        <div className={layout.points}>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>The runway, in days</h3>
            <p className={layout.pointBody}>
              Your balance measured against the date your next disbursement lands &mdash; not
              against the end of the month. September money has to reach January.
            </p>
          </div>

          <div className={layout.point}>
            <h3 className={layout.pointTitle}>A weekly number you can hold in your head</h3>
            <p className={layout.pointBody}>
              What is left, divided by the weeks remaining, rounded down. It is division, not a
              prediction, and you can check it yourself.
            </p>
          </div>

          <div className={layout.point}>
            <h3 className={layout.pointTitle}>Work-study is not counted</h3>
            <p className={layout.pointBody}>
              It is wages for hours worked, not a lump sum sitting in your account. Counting it
              would tell you that you have money in September that you have not earned yet.
            </p>
          </div>

          <div className={layout.point}>
            <h3 className={layout.pointTitle}>No date, no number</h3>
            <p className={layout.pointBody}>
              Without a disbursement date there is nothing to divide by. Fynliq asks for the date
              rather than dividing by a guess.
            </p>
          </div>
        </div>

        <div className={styles.pair}>
          <div className={styles.state}>
            {runway.status === 'ready' && (
              <Card hero>
                <MoneyMetric
                  label="Money left this semester"
                  value={runway.moneyLeft}
                  status={{ tone: 'green', text: 'On track' }}
                  note={
                    <>
                      Has to last {runway.daysRemaining} days, until {runway.until.label}. Safe
                      weekly is ${runway.safeWeekly}.
                    </>
                  }
                />
              </Card>
            )}
            <p className={styles.caption}>With a disbursement date</p>
          </div>

          <div className={styles.state}>
            {withoutDate.status === 'unavailable' && (
              <Card hero>
                <MissingMetric
                  label="Safe weekly"
                  prompt="Add your disbursement date"
                  explanation={`${withoutDate.prompt} We would rather show you the gap than a number that looks certain and is not.`}
                />
              </Card>
            )}
            <p className={styles.caption}>Without one</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
