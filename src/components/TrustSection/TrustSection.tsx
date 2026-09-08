import { Card, Section } from '../ui';
import styles from './TrustSection.module.css';

const RULES = [
  {
    title: 'A missing figure is shown as missing',
    body: 'Where your document does not state something, Fynliq says so. It never estimates a grant, a deadline or a disbursement date to fill a gap in a layout.',
    example: 'gift_aid.state_grants = not_found',
  },
  {
    title: 'No disbursement date means no weekly number',
    body: 'The weekly figure is your balance divided by the weeks until money arrives. With no date there is nothing to divide by, so you get a prompt instead of a guess.',
    example: 'safe_weekly = unavailable',
  },
  {
    title: 'Work-study never counts as cash',
    body: 'It is wages for hours worked. Counting it in your runway would tell you that you have money in September that you have not earned yet.',
    example: 'runway.work_study = excluded',
  },
  {
    title: 'The money maths is tested code, not a model',
    body: 'Runway and loan verdicts are comparisons and division, written as pure functions with tests. You can check every number yourself.',
    example: 'core/loan.ts \u00b7 core/runway.ts',
  },
];

export function TrustSection() {
  return (
    <Section
      id="trust"
      eyebrow="Responsible finance"
      title="What Fynliq will not do"
      lede="A finance app earns its place by being right about small things. These are the rules the beta is built to, and the reason a few screens deliberately show less than they could."
    >
      <ul className={styles.grid}>
        {RULES.map((rule, index) => (
          <Card as="li" key={rule.title}>
            <div className={styles.rule}>
              <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
              <h3 className={styles.title}>{rule.title}</h3>
              <p className={styles.body}>{rule.body}</p>
              <p className={styles.example}>{rule.example}</p>
            </div>
          </Card>
        ))}
      </ul>
    </Section>
  );
}
