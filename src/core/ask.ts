/**
 * Grounding a general answer in the student's own award.
 *
 * The search page answers the question everybody has. Ask Fynliq answers the
 * same question for one person, and the difference between the two is exactly
 * this file: the paragraph that states their figures instead of the rule.
 *
 * Rule 1 of the architecture applies here more than anywhere. Nothing that
 * composes one of these paragraphs is allowed to work out a dollar amount —
 * every figure below comes from `breakDownAward` and `analyseOutcome`, which
 * are tested, and the sentence is only allowed to arrange them.
 *
 * And the rule that matters most: when the document did not state what a
 * topic needs, this returns `null`. The interface then says the answer is the
 * general one and names what is missing, rather than quietly producing a
 * personalised-sounding paragraph with nothing behind it.
 */

import { analyseOutcome, type AidAnalysis } from './analysis';
import { formatUSD } from './money';

/** The subject areas the search library is organised by. */
export type AskTopic = 'refunds' | 'grants' | 'loans' | 'fafsa' | 'bill' | 'eligibility';

export interface Grounded {
  /** One paragraph, stating the student's own figures. */
  paragraph: string;
  /**
   * The fields on their document this was read from, named the way the rest
   * of the product names them. Shown under the answer as its provenance.
   */
  fields: string[];
}

export function groundInAward(topic: AskTopic, analysis: AidAnalysis): Grounded | null {
  const { aid, balance, sai } = analyseOutcome(analysis);

  switch (topic) {
    case 'refunds': {
      // A refund only exists when aid exceeds what the school charges, so
      // without this term's bill there is nothing to say about theirs.
      if (balance === null) return null;

      if (balance.stillOwed > 0) {
        return {
          paragraph: `On your own figures there is no credit balance to refund this term. Your bill is ${formatUSD(balance.bill)} and ${formatUSD(balance.grantsApplied)} of gift aid has been applied to it, which leaves ${formatUSD(balance.stillOwed)} the school is still asking you for. A refund is what is left after the bill is cleared, so any money that reaches you would come after that ${formatUSD(balance.stillOwed)} is covered.`,
          fields: ['semester.bill', 'semester.grantsApplied'],
        };
      }

      return {
        paragraph: `Your gift aid covers this term's bill of ${formatUSD(balance.bill)} in full, so anything disbursed beyond it is a credit balance — which is the money that reaches you as a refund. The 14-day rule above is counted from the day that balance appears on your account, not from the day you ask about it.`,
        fields: ['semester.bill', 'semester.grantsApplied'],
      };
    }

    case 'bill': {
      if (balance === null) return null;
      return {
        paragraph: `Your own figures: a bill of ${formatUSD(balance.bill)} this term, ${formatUSD(balance.grantsApplied)} of gift aid applied to it, and ${formatUSD(balance.stillOwed)} still being asked for. Every loan you were offered this term adds up to ${formatUSD(balance.loansAvailable)}${
          balance.afterAllLoans > 0
            ? `, which still leaves ${formatUSD(balance.afterAllLoans)} with nothing covering it. That gap is the thing to take to your aid office before you borrow anything.`
            : ', so the gap can be closed without anything being left uncovered.'
        }`,
        fields: ['semester.bill', 'semester.grantsApplied', 'semester.subsidizedAvailable'],
      };
    }

    case 'loans': {
      if (balance === null) {
        return {
          paragraph: `On your award, ${formatUSD(aid.loansOffered)} of the ${formatUSD(aid.offered)} offered to you is borrowed money rather than money you keep. What you uploaded did not state this term's bill, so Fynliq will not tell you how much of that you actually need — add the bill and this becomes a figure instead of a range.`,
          fields: ['award.lines'],
        };
      }

      return {
        paragraph: `For your own award the number to stop at is ${formatUSD(balance.stillOwed)} — that is what is genuinely uncovered after gift aid. You were offered ${formatUSD(balance.loansAvailable)} in loans this term, so accepting everything on the letter would mean borrowing ${formatUSD(Math.max(0, balance.loansAvailable - balance.stillOwed))} you do not owe and repaying it with interest for the privilege of having held it.`,
        fields: ['semester.bill', 'semester.grantsApplied', 'semester.subsidizedAvailable'],
      };
    }

    case 'grants': {
      return {
        paragraph: `On your own award, ${formatUSD(aid.giftAid)} of the ${formatUSD(aid.offered)} offered to you is gift aid — money you keep and never repay. That is the figure any change to your package should be measured against, and the one worth protecting in any conversation with your aid office.`,
        fields: ['award.lines'],
      };
    }

    case 'fafsa': {
      // The Submission Summary states the SAI or it does not. Nothing here
      // is willing to infer one.
      if (sai.value === null) return null;
      return {
        paragraph: `Your own Student Aid Index is ${sai.value}. ${sai.meaning}`,
        fields: ['sai'],
      };
    }

    case 'eligibility':
      // Enrolment level, grades and satisfactory academic progress are not on
      // an award letter. There is nothing honest to ground this in.
      return null;
  }
}

/** What to add so a topic that could not be grounded becomes personal. */
export const MISSING_FOR_TOPIC: Record<AskTopic, string> = {
  refunds: 'your student account statement, which states this term’s bill',
  bill: 'your student account statement, which states this term’s bill',
  loans: 'your student account statement, which states this term’s bill',
  grants: 'your award letter',
  fafsa: 'your FAFSA Submission Summary, which states your Student Aid Index',
  eligibility:
    'nothing Fynliq can read — enrolment level and academic progress are not printed on an award',
};
