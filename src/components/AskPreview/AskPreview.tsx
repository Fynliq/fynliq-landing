import { useEffect, useState } from 'react';
import { Card, Section, Skeleton } from '../ui';
import layout from '../../styles/layout.module.css';
import styles from './AskPreview.module.css';

interface Exchange {
  id: string;
  question: string;
  /** Short label for the chip, so it does not repeat the question verbatim. */
  chip: string;
  answer: string[];
  /** The fields in the student's own award the answer was read from. */
  grounding: string;
}

const EXCHANGES: Exchange[] = [
  {
    id: 'others',
    question: 'How did other people get so much more than me?',
    chip: 'Why others got more',
    answer: [
      'Usually one of four things, and three are fixable. A lower SAI from a different household picture. Institutional grants they asked for and you did not. A state grant with an earlier deadline. Or outside scholarships stacked on top.',
      'Your award shows no state grant and no FSEOG, so those two are worth asking about directly.',
    ],
    grounding: 'gift_aid.state_grants = not_found \u00b7 gift_aid.seog = not_found',
  },
  {
    id: 'grants',
    question: 'I only got a little in grants. Is that it?',
    chip: 'A low grant total',
    answer: [
      'Not necessarily. A low grant total usually means a higher SAI, but it can also mean your FAFSA had an error, you were selected for verification and have not finished it, or your school had not finished packaging your aid when the letter went out.',
      'Check your SAI on your Submission Summary first. If the household details there are wrong, a correction can change your whole package.',
    ],
    grounding: 'award.sai = not_found \u00b7 verification.status = not_found',
  },
  {
    id: 'drop',
    question: 'What happens to my Pell if I drop a class?',
    chip: 'Dropping a class',
    answer: [
      'Pell is paid against the hours you are actually enrolled in, not the hours your award letter assumed. Drop below full time and it is reduced proportionally; drop below half time and most aid stops entirely.',
      'Your award was packaged at full-time, twelve or more credit hours.',
    ],
    grounding: 'enrolment.assumed = full_time_12_hours',
  },
];

/** Long enough to show the skeleton, short enough not to feel like a wait. */
const THINKING_MS = 420;

export function AskPreview() {
  const [selected, setSelected] = useState(EXCHANGES[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoading(false), THINKING_MS);
    return () => window.clearTimeout(timer);
  }, [loading, selected]);

  const choose = (exchange: Exchange) => {
    if (exchange.id === selected.id) return;
    setSelected(exchange);
    setLoading(true);
  };

  return (
    <Section
      id="ask"
      eyebrow="Ask"
      title="Answers built from your own figures"
      lede="Ask a question in your own words and get an answer that cites the lines it read from your award. Where your award does not contain something, the answer says so rather than filling the gap."
      sunk
    >
      <div className={layout.split}>
        <Card hero>
          <div className={styles.thread}>
            <div className={styles.turn}>
              <span className={styles.who}>You</span>
              <p className={styles.question}>{selected.question}</p>
            </div>

            <div className={styles.turn}>
              <span className={styles.who}>Fynliq</span>
              <div className={styles.answer} aria-live="polite" aria-busy={loading}>
                {loading ? (
                  <>
                    <span className="srOnly">Reading your award</span>
                    <div className={styles.skeletonLines}>
                      <Skeleton height="15px" />
                      <Skeleton height="15px" />
                      <Skeleton height="15px" width="82%" />
                      <Skeleton height="15px" width="46%" />
                    </div>
                    <div className={styles.grounding}>
                      <Skeleton height="13px" width="64%" radius="var(--r-pill)" />
                    </div>
                  </>
                ) : (
                  <>
                    {selected.answer.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    <p className={styles.grounding}>
                      <span aria-hidden="true">&#9679;</span>
                      From {selected.grounding}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={styles.prompts}>
            {EXCHANGES.map((exchange) => (
              <button
                key={exchange.id}
                type="button"
                className={`${styles.prompt} ${
                  exchange.id === selected.id ? styles.promptOn : ''
                }`}
                aria-pressed={exchange.id === selected.id}
                aria-label={exchange.question}
                onClick={() => choose(exchange)}
              >
                {exchange.chip}
              </button>
            ))}
          </div>
        </Card>

        <div className={layout.points}>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>Grounded in what you added</h3>
            <p className={layout.pointBody}>
              Every answer names the fields it read. If a figure is not in your award, the answer
              reports it as not found instead of producing a plausible number.
            </p>
          </div>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>The maths is not the model&rsquo;s job</h3>
            <p className={layout.pointBody}>
              Your runway, your totals and your loan verdict are computed as pure functions and
              tested. A model that adds up your grants produces a number nobody can verify.
            </p>
          </div>
          <div className={layout.point}>
            <h3 className={layout.pointTitle}>Skeletons while it reads</h3>
            <p className={layout.pointBody}>
              Loading states are sized to the answer that replaces them, so nothing on the screen
              jumps when it arrives.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
