/**
 * The six routes to money that is not borrowed.
 *
 * These are categories and the questions to ask, not listings. No scholarship,
 * amount or deadline here is invented: where a figure is a published federal
 * range it is given as a range, and where it varies it says so.
 */
export interface Route {
  id: string;
  title: string;
  /** A range, or an honest description of why there is no figure. */
  worth: string;
  /** True when `worth` is a real amount rather than a description. */
  worthIsAmount: boolean;
  body: string;
  /** The exact wording a student can send. Copyable. */
  message?: string;
  meta: [string, string];
}

export const ROUTES: Route[] = [
  {
    id: 'institutional',
    title: 'Ask about institutional grants',
    worth: '$500\u20135,000',
    worthIsAmount: true,
    body: 'Schools hold their own grant money and rarely advertise it. Some goes unclaimed every year. This is the most common thing students never think to ask for.',
    message:
      'Are there any institutional grants or departmental scholarships I might still qualify for this year?',
    meta: ['Five minutes', 'Email or walk in'],
  },
  {
    id: 'appeal',
    title: 'Appeal your award',
    worth: 'Varies',
    worthIsAmount: false,
    body: 'When your package leaves a gap with nothing covering it, most schools accept appeals — and most students never file one. Ask what their process is and what it needs from you.',
    message:
      'My package leaves a gap that nothing is covering. Do you accept financial aid appeals, and what would you need from me?',
    meta: ['Deadlines vary', 'Ask early in the term'],
  },
  {
    id: 'special',
    title: 'Special circumstances review',
    worth: 'Can raise Pell',
    worthIsAmount: false,
    body: 'Your aid came from an older tax year. If your household has since had a job loss, an income drop, unusual medical bills, or a change in size, your school can recalculate with current figures. This is the one route that can genuinely increase a Pell Grant — and only your school can approve it.',
    message:
      "My family's financial situation has changed since the tax year my FAFSA used. Can you review my file for special circumstances?",
    meta: ['Needs documents', 'School decides'],
  },
  {
    id: 'fseog',
    title: 'Ask about FSEOG',
    worth: '$100\u20134,000',
    worthIsAmount: true,
    body: 'A federal grant for students with the highest need. Schools get a limited pot and give it out first-come, so it runs dry. If it was not on your award, it is worth asking whether you were considered.',
    message: 'Was I considered for FSEOG this year, and is any still available?',
    meta: ['Runs out early', 'Ask now'],
  },
  {
    id: 'state',
    title: 'Check your state grant',
    worth: 'Varies by state',
    worthIsAmount: false,
    body: 'Most states run their own grant programme with a separate deadline, often earlier than the federal one. No state grant on your award might mean a missed deadline, or might mean nobody checked.',
    meta: ['Separate deadline', 'Your state agency'],
  },
  {
    id: 'work-study',
    title: 'Claim your work-study',
    worth: 'Paid as wages',
    worthIsAmount: false,
    body: 'If you were offered work-study it is not automatic — you have to find and take an eligible job, and campus roles go fast in the first weeks. It pays as wages, so it will not reduce your September bill.',
    meta: ['Apply through your school', 'Fills up fast'],
  },
];
