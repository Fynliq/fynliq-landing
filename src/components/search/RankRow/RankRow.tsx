import {
  CATEGORY_LABEL,
  type Question,
} from '../../../search/library';
import {
  formatMovement,
  groupedNote,
  searchProof,
  volumeShare,
  type RankedQuestion,
} from '../../../core';
import styles from './RankRow.module.css';

interface RankRowProps {
  question: Question;
  demand: RankedQuestion;
  /** The most-searched question's 30-day volume, for scaling the bar. */
  top: number;
  onOpen: () => void;
}

/** Which way the rank moved, for the chip's styling and its screen-reader text. */
function movementState(movement: number | null): 'new' | 'up' | 'down' | 'held' {
  if (movement === null) return 'new';
  if (movement > 0) return 'up';
  if (movement < 0) return 'down';
  return 'held';
}

const MOVEMENT_NOTE: Record<'new' | 'up' | 'down' | 'held', string> = {
  new: 'new to the ranking',
  up: 'places up this week',
  down: 'places down this week',
  held: 'holding its position',
};

/**
 * One row of the most-searched ranking.
 *
 * The bar is the design decision worth explaining. A numbered list tells you
 * the order; it does not tell you that the question at the top is searched
 * four times as often as the one in fourth, which is the actual shape of what
 * students are worried about. The bar is drawn from the same figure the
 * bubble prints, by `volumeShare`, so the two can never disagree.
 */
export function RankRow({ question, demand, top, onOpen }: RankRowProps) {
  const grouped = groupedNote(demand.variants);
  const state = movementState(demand.movement);
  const share = volumeShare(demand.searches30d, top);

  return (
    <li className={styles.row}>
      <a className={styles.link} href={`/search/${question.slug}`} onClick={onOpen}>
        <span className={styles.rank} aria-hidden="true">
          {String(demand.rank).padStart(2, '0')}
        </span>
        <span className="srOnly">Number {demand.rank}. </span>

        <span className={styles.body}>
          <span className={styles.head}>
            <span className={styles.question}>{question.question}</span>
            {/*
              A question that has not moved prints nothing. Fifteen rows each
              saying "Holding" is fifteen rows of noise that bury the four
              that did move, which are the only ones the chip is there for.
              The position is still announced, because a screen reader has no
              column of arrows to notice the absence in.
            */}
            <span className={`${styles.move} ${styles[state]}`}>
              {state === 'held' ? '' : formatMovement(demand.movement)}
              <span className="srOnly">
                {demand.movement === null ? '' : Math.abs(demand.movement)}{' '}
                {MOVEMENT_NOTE[state]}
              </span>
            </span>
          </span>

          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ transform: `scaleX(${share.toFixed(4)})` }} />
          </span>

          <span className={styles.proof}>
            <span className={styles.bubble}>{searchProof(demand.searches30d)}</span>
            <span className={styles.category}>{CATEGORY_LABEL[question.category]}</span>
            {grouped && <span className={styles.grouped}>{grouped}</span>}
          </span>
        </span>
      </a>
    </li>
  );
}
