import { Card, Section } from '../ui';
import layout from '../../styles/layout.module.css';
import styles from './TaskList.module.css';

type Urgency = 'rust' | 'gold' | 'low';

interface Task {
  title: string;
  note: string;
  when: string;
  urgency: Urgency;
  done?: boolean;
}

const GROUPS: { label: string; count: string; tasks: Task[] }[] = [
  {
    label: 'This month',
    count: '3 open',
    tasks: [
      {
        title: 'Accept or decline your loans',
        note: 'Decide the amount first, then submit it in your portal.',
        when: 'Due 15 September',
        urgency: 'rust',
      },
      {
        title: 'Ask about institutional grants',
        note: 'Five-minute email. The highest-value thing on this list.',
        when: 'Sooner is better',
        urgency: 'gold',
      },
      {
        title: 'Register for classes before disbursement',
        note: 'Aid pays against real enrolment. Full-time keeps your full Pell.',
        when: 'Before 3 September',
        urgency: 'gold',
      },
    ],
  },
  {
    label: 'Coming up',
    count: '1 open',
    tasks: [
      {
        title: 'Renew your FAFSA for 2027\u201328',
        note: 'Opens 1 October. The most common way students lose Pell.',
        when: 'Opens 1 October',
        urgency: 'low',
      },
    ],
  },
  {
    label: 'Done',
    count: '1 done',
    tasks: [
      {
        title: 'Confirm your FAFSA details are accurate',
        note: 'Reviewed at studentaid.gov.',
        when: 'Done',
        urgency: 'low',
        done: true,
      },
    ],
  },
];

const WHEN_CLASS: Record<Urgency, string> = {
  rust: styles.whenRust,
  gold: styles.whenGold,
  low: styles.whenLow,
};

export function TaskList() {
  return (
    <Section
      id="tasks"
      eyebrow="Tasks"
      title="Deadlines, grouped by how soon they bite"
      lede="Financial aid is mostly a sequence of dates. Fynliq keeps them in one list, ordered by urgency, with FAFSA renewal at the top of the calendar every October."
    >
      <div className={layout.split}>
        <Card hero>
          <div className={styles.groups}>
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className={styles.groupLabel}>
                  <span>{group.label}</span>
                  <span>{group.count}</span>
                </p>
                <ul>
                  {group.tasks.map((task) => (
                    <li
                      key={task.title}
                      className={`${styles.task} ${task.done ? styles.done : ''}`}
                    >
                      <span
                        className={`${styles.ring} ${task.done ? styles.ringDone : ''}`}
                        aria-hidden="true"
                      >
                        {task.done ? '\u2713' : ''}
                      </span>
                      <span>
                        <span className={styles.title}>{task.title}</span>
                        <span className={styles.note}>{task.note}</span>
                      </span>
                      <span className={`${styles.when} ${WHEN_CLASS[task.urgency]}`}>
                        {task.when}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <div className={layout.points}>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>FAFSA renewal is the one that costs the most</h3>
            <p className={layout.pointBody}>
              It opens on 1 October and it is not automatic. Missing it is the most common way a
              student loses a Pell Grant they were otherwise entitled to.
            </p>
          </div>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>Urgency is stated, not just coloured</h3>
            <p className={layout.pointBody}>
              Every date carries its own words &mdash; due, opens, before &mdash; so the list still
              reads correctly without seeing the colour.
            </p>
          </div>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>Nothing is added that you did not give us</h3>
            <p className={layout.pointBody}>
              Deadlines come from your school, your state agency and the federal calendar. Fynliq
              never fills the list with plausible-looking dates.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
