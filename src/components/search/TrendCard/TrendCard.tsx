import { formatMomentum, groupedNote, searchProof, type RankedQuestion } from '../../../core';
import type { Question } from '../../../search/library';
import { Sparkline } from '../Sparkline/Sparkline';
import styles from './TrendCard.module.css';

interface TrendCardProps {
  question: Question;
  demand: RankedQuestion;
  onOpen: () => void;
}

/**
 * One rising question.
 *
 * The badge says how fast in words and the sparkline says the same thing as a
 * shape — which is not redundancy: "2.3× this week" and a line that climbs
 * steadily are different claims from "2.3× this week" and a line that was
 * flat for six days and spiked on the seventh.
 */
export function TrendCard({ question, demand, onOpen }: TrendCardProps) {
  const grouped = groupedNote(demand.variants);

  return (
    <a className={styles.card} href={`/search/${question.slug}`} onClick={onOpen}>
      <div className={styles.top}>
        <span className={styles.badge}>
          <span className={styles.arrow} aria-hidden="true">
            &uarr;
          </span>
          {formatMomentum(demand.momentum)}
        </span>

        <Sparkline
          values={demand.daily}
          label={`Searches over the last seven days, ending at ${demand.daily[demand.daily.length - 1]} yesterday`}
        />
      </div>

      <h3 className={styles.question}>{question.question}</h3>

      <p className={styles.answer}>{question.answer}</p>

      <div className={styles.proof}>
        <span className={styles.bubble}>{searchProof(demand.searches30d)}</span>
        {grouped && <span className={styles.grouped}>{grouped}</span>}
      </div>
    </a>
  );
}
