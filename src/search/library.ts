/**
 * The canonical questions, and the answers students get for them.
 *
 * This file is the *editorial* half of the search page. The other half —
 * how often each of these is searched, how fast it is rising, and which
 * phrasings got folded into which question — is analytics, and arrives
 * through `analytics.ts` from outside. Keeping them apart is what lets the
 * ranking change every day without anybody editing this list.
 *
 * Two rules, inherited from the rest of the product:
 *
 *   1. No answer here states a figure about a particular student. These are
 *      general rules, and where a rule has a published federal number (the
 *      14-day credit balance window, half-time enrolment, the 60% point of a
 *      term) it is given as that rule and attributed to it. Anything specific
 *      to somebody's own award belongs on Ask Fynliq, where their document is.
 *   2. Every answer ends by naming what only their own school can settle.
 *      A page that sounds more certain than it can be is the failure mode
 *      that costs a student money.
 *
 * `variants` are the seed phrasings used for matching what somebody types
 * before any analytics have loaded. The backend will send back the phrasings
 * it actually clustered; both are used, and neither is authoritative over the
 * other. See `docs/SEARCH_ANALYTICS_API.md`.
 */

export type CategoryId =
  | 'refunds'
  | 'grants'
  | 'loans'
  | 'fafsa'
  | 'bill'
  | 'eligibility';

export interface Category {
  id: CategoryId;
  label: string;
  /** One line, shown when the category is the active filter. */
  blurb: string;
}

export const CATEGORIES: Category[] = [
  {
    id: 'refunds',
    label: 'Refunds & disbursement',
    blurb: 'When money actually moves, and what to do when it has not.',
  },
  {
    id: 'grants',
    label: 'Grants & free money',
    blurb: 'Money you keep — where it comes from, and why it changes.',
  },
  {
    id: 'loans',
    label: 'Loans',
    blurb: 'What to accept, what to decline, and what it costs either way.',
  },
  {
    id: 'fafsa',
    label: 'FAFSA & verification',
    blurb: 'The form, the Student Aid Index, and the paperwork that holds aid up.',
  },
  {
    id: 'bill',
    label: 'Bills & costs',
    blurb: 'What the school is charging, and what is left once aid is applied.',
  },
  {
    id: 'eligibility',
    label: 'Staying eligible',
    blurb: 'Enrolment, grades and the rules that quietly end an award.',
  },
];

export const CATEGORY_LABEL: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.label]),
) as Record<CategoryId, string>;

export interface Question {
  id: string;
  /** The URL segment. Stable — it is what a shared link points at. */
  slug: string;
  /** The canonical phrasing every variant collapses into. */
  question: string;
  category: CategoryId;
  /** The answer, stated before it is explained. One or two sentences. */
  answer: string;
  /** The explanation behind it. */
  body: string[];
  /** What to do next, in the order it is worth doing. Optional. */
  steps?: string[];
  /** The part only their own school or document can settle. Always present. */
  checkYourself: string;
  /** Other canonical questions worth reading next, by id. */
  related: string[];
  /** Seed phrasings for local matching. The backend sends the real clusters. */
  variants: string[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'refund-arrival',
    slug: 'when-will-my-financial-aid-refund-arrive',
    question: 'When will my financial aid refund arrive?',
    category: 'refunds',
    answer:
      'Your aid pays the school first. Whatever is left over is a credit balance, and federal rules give your school 14 days to pay it out to you once that balance exists.',
    body: [
      'Aid does not arrive in your account. It disburses to your school, which applies it to tuition, fees and anything else you are charged there. Only when that leaves money over do you have a credit balance — and the credit balance is what people mean by a refund.',
      'Federal rules give the school 14 days to pay a credit balance to you, counted from the day the balance appeared, or from the first day of classes if it appeared before the term started. Aid also cannot normally disburse more than 10 days before the term begins, so the earliest realistic date is a little before classes and the usual one is a week or two after.',
      'When a refund is late, it is almost never the refund itself. It is something upstream still holding the disbursement: unfinished verification, a missing loan agreement or entrance counselling, an admissions or health hold on your account, enrolment below what your award assumed, or a refund preference you never set — in which case a cheque is in the post rather than money in your bank.',
    ],
    steps: [
      'Open your student account and look for the disbursement, not the refund. If aid has not posted, the refund has not been delayed — it has not been created yet.',
      'Check for holds on your account, and check your to-do list for an outstanding document.',
      'Confirm your refund preference is set to direct deposit with the right account.',
      'If aid has posted and it has been more than 14 days, ask the bursar or student accounts office for the date the credit balance was created.',
    ],
    checkYourself:
      'Your school sets its own disbursement calendar inside those federal limits, and it is the only place that can tell you the date your balance was created. The bursar handles refunds; the aid office handles what is holding the aid up.',
    related: ['refund-spend', 'bill-gap', 'verification'],
    variants: [
      'when will my refund come',
      'where is my financial aid refund',
      "why hasn't my refund hit",
      'how long does a financial aid refund take',
      'financial aid refund date',
      'when does fafsa money come in',
    ],
  },
  {
    id: 'refund-spend',
    slug: 'what-can-i-spend-my-refund-on',
    question: 'What am I allowed to spend my refund on?',
    category: 'refunds',
    answer:
      'Education costs, which is broader than tuition: housing, food, transport, books, supplies, a computer, childcare. The real question is usually not what it is for but whether you are spending a grant or a loan.',
    body: [
      'A refund is the part of your aid that exceeded what the school charged you directly. It is meant for the rest of your cost of attendance — the living costs your school already estimated when it worked out how much aid you could receive.',
      'Nobody itemises your receipts. But a refund that came out of a loan is borrowed money you will repay with interest, and on an unsubsidized loan that interest started the day it disbursed. The same $600 spent the same way costs nothing if it came from a Pell Grant and costs considerably more than $600 if it came from a loan.',
      'That is why the decision worth making is at the point of accepting, not at the point of spending: if you do not need the full loan to cover your costs, accepting less is the cheapest move available to you, and you can usually reduce or cancel it shortly after it disburses.',
    ],
    checkYourself:
      'Your award tells you which of your money is gift aid and which is borrowed. If you are not sure which produced your refund, Fynliq can read your award and split it, or your aid office can tell you line by line.',
    related: ['loan-accept-amount', 'sub-vs-unsub', 'refund-arrival'],
    variants: [
      'can i use my refund for rent',
      'what can i buy with financial aid money',
      'is it illegal to spend financial aid refund',
      'can i keep my financial aid refund',
    ],
  },
  {
    id: 'bill-gap',
    slug: 'my-aid-does-not-cover-my-bill',
    question: 'My aid does not cover my bill. What do I do?',
    category: 'bill',
    answer:
      'Work through it in order, and borrow last. A gap is often smaller than it looks once every piece of aid has actually posted, and there are three things worth asking for before you take on debt to close it.',
    body: [
      'Start by checking that the bill is final and that all of your aid has disbursed. A balance shown before disbursement, or before a late scholarship posts, is a bill that has not finished settling. Students borrow to cover gaps that close on their own more often than anybody admits.',
      'If the gap is real, it does not follow that a loan is the answer to it. A payment plan spreads the same amount across the term without interest at most schools. Institutional grant money and emergency aid funds exist at nearly every school and are rarely advertised. And if your household income has dropped since the tax year your FAFSA used, a special circumstances review can change the aid you are offered outright, which is the only route here that can increase a grant.',
      'Only then is borrowing the right move — and if it is, subsidized loans first, then unsubsidized, and only up to what is actually uncovered. Every dollar you accept above the gap is a dollar you pay interest on for the privilege of holding it.',
    ],
    steps: [
      'Confirm every award on your letter has actually posted to the account.',
      'Ask the bursar what payment plans exist and what they cost.',
      'Ask the aid office about institutional grants, departmental awards and emergency funds.',
      'If your income has changed since the FAFSA tax year, ask for a special circumstances review.',
      'Borrow last, subsidized first, and only up to the gap.',
    ],
    checkYourself:
      'Only your school can tell you which of its own funds you might still qualify for, and its deadlines for asking. That conversation is free and most students never have it.',
    related: ['appeal', 'loan-accept-amount', 'refund-arrival'],
    variants: [
      'i still owe money after financial aid',
      'balance left after financial aid',
      'how do i pay the rest of my tuition',
      'financial aid did not cover everything',
      'what if my aid is not enough',
    ],
  },
  {
    id: 'loan-accept-amount',
    slug: 'how-much-of-my-loan-should-i-accept',
    question: 'How much of my loan should I actually accept?',
    category: 'loans',
    answer:
      'Only as much as is still uncovered after your grants and scholarships. A loan offer is a maximum you are allowed to borrow, not an amount you are expected to take.',
    body: [
      'You can accept all of a loan, part of it, or none of it. Nothing about declining it affects your grants, and nothing about it is recorded against you. Schools present loans alongside gift aid on the same letter, which makes the whole thing read like one package, but only the gift aid half is money.',
      'Take subsidized before unsubsidized where you have the choice: on a subsidized loan the government pays the interest while you are enrolled at least half time, through your grace period and during approved deferments. On an unsubsidized loan interest accrues from the day the money disburses, and unpaid interest is eventually added to the balance you owe interest on.',
      'Expect slightly less to arrive than you accepted. A loan origination fee is deducted before disbursement, so the amount that reaches your account is a little under the amount on the letter — worth knowing if you are borrowing to hit an exact bill.',
      'If you accept too much, you usually have a window after disbursement to return some of it without paying interest or fees on the part you send back. Ask your aid office what that window is at your school rather than assuming you are stuck with it.',
    ],
    checkYourself:
      'What is genuinely uncovered depends on your own bill and your own gift aid. Fynliq works that figure out from your award if you upload it, and your aid office can confirm the accept, reduce and cancel deadlines.',
    related: ['sub-vs-unsub', 'bill-gap', 'refund-spend'],
    variants: [
      'do i have to accept all my loans',
      'can i accept only part of my loan',
      'should i take the full loan amount',
      'how do i decline a student loan',
      'can i say no to loans on my award letter',
    ],
  },
  {
    id: 'sub-vs-unsub',
    slug: 'subsidized-vs-unsubsidized-loans',
    question: 'What is the difference between a subsidized and an unsubsidized loan?',
    category: 'loans',
    answer:
      'Who pays the interest while you are still in school. On a subsidized loan the government does. On an unsubsidized loan you do, from the day it disburses.',
    body: [
      'A Direct Subsidized Loan is awarded on financial need, and the government covers the interest while you are enrolled at least half time, during your six-month grace period, and in approved periods of deferment. The balance you start repaying is the amount you borrowed.',
      'A Direct Unsubsidized Loan is not need-based, and interest begins accruing the day the money disburses. If you do not pay that interest while you study, it is capitalised — added to your principal — and from then on you pay interest on the interest. The balance you start repaying is larger than the amount you borrowed.',
      'So the order is not a preference, it is arithmetic: accept subsidized first, up to what you are offered, then unsubsidized only for what is still uncovered. If you can pay even part of the accruing interest on an unsubsidized loan while you are enrolled, you reduce what gets capitalised.',
    ],
    checkYourself:
      'Your award letter names which of your loans is which, and studentaid.gov shows your current balances and rates. If your letter only says "Direct Loan", ask the aid office to confirm the split before you accept.',
    related: ['loan-accept-amount', 'refund-spend', 'bill-gap'],
    variants: [
      'subsidized vs unsubsidized',
      'which student loan is better',
      'what does subsidized mean',
      'is unsubsidized loan bad',
      'difference between direct loans',
    ],
  },
  {
    id: 'why-less-aid',
    slug: 'why-did-my-aid-go-down',
    question: 'Why did I get less aid this year than last year?',
    category: 'grants',
    answer:
      'Usually one of six things, and most of them are worth a phone call. A smaller award is frequently a paperwork state rather than a final decision.',
    body: [
      'The most common cause is that the tax year your FAFSA drew on changed, and the household picture in it improved — even if the household did not feel any richer. A one-off event in that year, a retirement withdrawal, a sold asset or a second earner, moves your Student Aid Index and moves your aid with it.',
      'The next most common is that something is unfinished. Verification not completed, a correction not submitted, a state grant whose deadline passed earlier than the federal one, or aid packaged before your school had all the pieces. In each of those the smaller number is provisional and nobody will tell you so unless you ask.',
      'Then there are the ones that are genuinely structural: a one-year scholarship that has ended, a change in your enrolment level, satisfactory academic progress, or Pell lifetime eligibility running down — Pell is capped at the equivalent of six years of full-time awards, and your usage is shown on studentaid.gov.',
      'And if your household income has dropped since the tax year in question, none of the above matters as much as the fact that you can ask your school to recalculate on current figures. That is the one route that can raise a Pell Grant, and only your school can approve it.',
    ],
    checkYourself:
      'Compare this year and last year on your Submission Summaries: the Student Aid Index is the number that explains most of the change. Anything unfinished shows on your school portal to-do list.',
    related: ['appeal', 'verification', 'sai-meaning'],
    variants: [
      'my financial aid went down',
      'why is my pell grant smaller this year',
      'my award is lower than last year',
      'i got less money this semester',
      'why did my grant decrease',
    ],
  },
  {
    id: 'appeal',
    slug: 'can-i-appeal-my-financial-aid-award',
    question: 'Can I appeal my financial aid award?',
    category: 'grants',
    answer:
      'Yes, and there are two different things you can ask for. Knowing which one you want is most of what decides whether it works.',
    body: [
      'The first is a special circumstances review, sometimes called professional judgment. It is for when your financial picture has genuinely changed since the tax year your FAFSA used — a job loss, an income drop, unusual medical bills, a separation, a death in the family, a change in household size. Your school can recalculate your eligibility on current figures, which can change your Student Aid Index and increase need-based aid including a Pell Grant. It is the only route on this page that can do that.',
      'The second is an appeal for more of your school’s own money, where nothing has changed but the offer is not enough to make attendance possible. That is a discretionary decision out of a limited institutional pot, and it is decided partly on how early you ask, because the pot empties.',
      'Both are documented requests, not arguments. Schools want the paperwork that evidences the change — termination letters, current pay stubs, benefit statements, medical bills — and a short factual letter that says what changed, when, and what it means for what you can pay. Emotion in the letter does not help. Dates and figures do.',
    ],
    steps: [
      'Ask the aid office which process applies to your situation and what form it uses.',
      'Gather the documents that evidence the change before you write anything.',
      'Write one page: what changed, when, the figures, and what you are asking for.',
      'Ask what the decision timeline is, and whether it affects your bill deadline.',
    ],
    checkYourself:
      'Every school runs this differently and most have their own form and their own deadline. There is no federal appeal process — the decision is entirely your school’s.',
    related: ['why-less-aid', 'bill-gap', 'sai-meaning'],
    variants: [
      'how to ask for more financial aid',
      'financial aid appeal letter',
      'can i get my award reconsidered',
      'professional judgment financial aid',
      'special circumstances financial aid',
    ],
  },
  {
    id: 'verification',
    slug: 'what-does-selected-for-verification-mean',
    question: 'What does it mean that I was selected for verification?',
    category: 'fafsa',
    answer:
      'Your FAFSA is being checked against documents. It is not an accusation, and a good share of selections are random — but your aid cannot disburse until it is finished.',
    body: [
      'Verification is a confirmation step. The school is required to check that certain answers on your FAFSA match the underlying records, usually income, household size, or identity. Some students are selected at random, some because an answer looked inconsistent, and being selected says nothing about whether you did anything wrong.',
      'What matters is the timing. Until verification is complete, aid stays unpaid: no disbursement, no credit balance, no refund, and a bill that looks unpaid on a deadline that does not move for you. Most of the damage verification does is done by students who left the to-do list for a fortnight.',
      'Submit exactly what is listed, in the format requested. The two things that stall it most often are a tax return sent where a tax transcript was asked for, and a form signed by the wrong person. If verification turns up a genuine error, your FAFSA is corrected and your award is recalculated — which can move it in either direction.',
    ],
    steps: [
      'Open your school portal to-do list and read what is actually requested, item by item.',
      'Request any tax transcript early; it is the item with the longest wait.',
      'Submit everything in one go rather than as it arrives.',
      'Confirm with the aid office that the file is complete, and ask whether your bill deadline is affected.',
    ],
    checkYourself:
      'Only your school can tell you your file is complete, and only your school sets the deadline for it. Federal deadlines exist behind it and missing them can cost the aid outright.',
    related: ['refund-arrival', 'why-less-aid', 'sai-meaning'],
    variants: [
      'why was i selected for verification',
      'what is verification financial aid',
      'does verification mean i did something wrong',
      'how long does verification take',
      'verification holding up my aid',
    ],
  },
  {
    id: 'sai-meaning',
    slug: 'what-does-my-student-aid-index-mean',
    question: 'What does my Student Aid Index actually mean?',
    category: 'fafsa',
    answer:
      'It is not a bill and it is not what you will pay. It is an index your school subtracts from your cost of attendance to measure how much need you have.',
    body: [
      'The Student Aid Index replaced the Expected Family Contribution, and the rename was the point: nobody was ever expected to hand over the EFC, but the name convinced a generation of families that they were. The SAI is an eligibility number produced by a formula from your FAFSA answers.',
      'Your school takes its own cost of attendance for the year, subtracts your SAI, and treats the remainder as your financial need. That is the figure need-based aid is drawn against — Pell, subsidized loans, campus-based funds and most institutional grant money. A lower SAI means more measured need.',
      'It can be negative, which is not an error: the formula reports down to −1,500 so schools can distinguish between levels of need that used to flatten to zero. The thresholds that decide a Pell award are set federally and change every award year, so the honest thing to say about any particular SAI is what band of need it puts you in, not what it will pay.',
    ],
    checkYourself:
      'Your SAI is printed on the first page of your FAFSA Submission Summary. If the household details behind it are wrong, a correction can change your whole package — and that is worth checking before anything else.',
    related: ['verification', 'why-less-aid', 'appeal'],
    variants: [
      'what is sai',
      'what happened to efc',
      'is sai what i have to pay',
      'student aid index explained',
      'my sai is negative',
    ],
  },
  {
    id: 'pell-drop-class',
    slug: 'what-happens-to-my-pell-if-i-drop-a-class',
    question: 'What happens to my aid if I drop a class?',
    category: 'eligibility',
    answer:
      'It depends on when you drop and what it leaves you enrolled in. Pell is paid against the hours you are actually taking, and below half time most other federal aid stops entirely.',
    body: [
      'Your award letter was packaged on an assumption about your enrolment, usually full time. Pell is prorated against what you are actually enrolled in, so dropping from full time to three-quarter or half time reduces it proportionally. Most other federal aid, including Direct Loans, requires at least half-time enrolment to be paid at all — so the drop that takes you from seven credits to five is a far bigger event than the one that takes you from twelve to nine.',
      'Timing decides whether it is recalculated. Schools set a census date early in the term, and enrolment on that date is generally what aid is locked to. Drop before it and your aid is recalculated against the smaller load; drop after it and the school’s own policy decides, which sometimes means the aid stands and sometimes means it is adjusted.',
      'Withdrawing from everything is a different rule again. If you stop attending before you have completed 60% of the term, the school must calculate how much of your federal aid you actually earned and return the rest — which can leave you owing your school money you have already spent.',
    ],
    checkYourself:
      'Your school’s census date, its recalculation policy and its definition of full time are all local, and all decide this. Ask the aid office before you drop, not after — the order of those two events is the whole difference.',
    related: ['sap', 'refund-arrival', 'why-less-aid'],
    variants: [
      'will i lose my financial aid if i drop a class',
      'dropping below full time financial aid',
      'does dropping a class affect pell',
      'what happens if i withdraw from a class',
      'can i drop a class without losing aid',
    ],
  },
  {
    id: 'sap',
    slug: 'satisfactory-academic-progress',
    question: 'How do my grades affect my financial aid?',
    category: 'eligibility',
    answer:
      'Through satisfactory academic progress, which is three separate tests. Failing any one of them can suspend your aid, and most students only learn the rules after they have broken one.',
    body: [
      'The first test is your grade point average, commonly a 2.0 cumulative minimum. The second is pace: the share of the credits you attempt that you actually complete, commonly two-thirds. The third is maximum timeframe — you cannot draw aid indefinitely, and eligibility usually ends at 150% of the published length of your programme.',
      'Pace is the one that catches people, because withdrawals count. A class you dropped after the census date is attempted and not completed, and a term of Ws can put you under the threshold with an untouched GPA. Repeated courses and transferred credits count too, in ways that vary by school.',
      'Failing normally triggers a warning term first, with aid intact, then suspension. Suspension is appealable: you explain what happened, evidence it, and agree an academic plan that returns you to standard. Schools approve these regularly, but the appeal has a deadline and the aid stays off until it is granted.',
    ],
    checkYourself:
      'Every threshold above is a common value, not a federal one — your school publishes its own SAP policy, and that document is the only authority on where your lines are.',
    related: ['pell-drop-class', 'why-less-aid', 'summer-aid'],
    variants: [
      'financial aid suspension',
      'sap appeal',
      'lost my financial aid because of grades',
      'what gpa do i need for financial aid',
      'satisfactory academic progress',
    ],
  },
  {
    id: 'work-study',
    slug: 'why-has-my-work-study-not-shown-up',
    question: 'Why has my work-study money not shown up?',
    category: 'grants',
    answer:
      'Because it is wages, not an award. Work-study is a pot you are allowed to earn against by working an eligible job, and it is paid to you in paychecks rather than applied to your bill.',
    body: [
      'The figure on your award letter is a ceiling on what you may earn in that programme over the year, not money set aside in your name. If you never take an eligible job, none of it exists. If you work, you are paid at least monthly for the hours you worked, like any other job.',
      'That is why it never appears on your student account and never reduces the balance you owe: it is income, arriving through the term, not aid applied to a bill in August. Budgeting as though it were a lump sum is the single most common mistake made with it, and the reason Fynliq leaves work-study out of your runway entirely.',
      'Campus roles are also finite and go quickly in the first weeks of term. If you were offered work-study and want it, applying is the whole of the work — the offer itself does nothing.',
    ],
    checkYourself:
      'Your school runs the job board and decides which positions are work-study eligible. Ask the aid office or student employment office how to be hired against your award.',
    related: ['bill-gap', 'refund-arrival', 'outside-scholarship'],
    variants: [
      'how does work study get paid',
      'work study not on my bill',
      'when do i get work study money',
      'is work study worth it',
      'work study not applied to tuition',
    ],
  },
  {
    id: 'outside-scholarship',
    slug: 'will-an-outside-scholarship-reduce-my-aid',
    question: 'Will an outside scholarship reduce my financial aid?',
    category: 'grants',
    answer:
      'It can, and you have to report it — but what it reduces is often up to you. Ask your school to take it off your loans before it takes it off your grants.',
    body: [
      'You are required to tell your school about scholarships you win elsewhere. Your total aid is not allowed to exceed your cost of attendance, and for need-based aid the limit is tighter still, so a large outside award sometimes has to be made room for.',
      'Making room does not have to mean losing a grant. Schools generally have discretion over what they reduce first, and reducing unmet need, then loans, then work-study, is both common practice and what you should ask for by name. The outcome where a scholarship you worked for cancels out a grant you already had is the one to head off, and asking early is how.',
      'Small awards below the threshold often change nothing at all. Report it regardless — the aid you would jeopardise by not reporting it is worth far more than the scholarship.',
    ],
    checkYourself:
      'Your school decides the order in which it reduces aid. Ask the aid office to reduce loans before gift aid, in writing, when you report the scholarship.',
    related: ['work-study', 'bill-gap', 'why-less-aid'],
    variants: [
      'do i have to report my scholarship',
      'scholarship displacement',
      'will my aid go down if i win a scholarship',
      'outside scholarship affects financial aid',
    ],
  },
  {
    id: 'summer-aid',
    slug: 'can-i-get-financial-aid-for-summer',
    question: 'Can I get financial aid for summer classes?',
    category: 'eligibility',
    answer:
      'Often yes. A Pell Grant can pay for summer on top of a full year if you meet the enrolment requirement and have eligibility left — but it usually needs a separate application.',
    body: [
      'Year-round Pell lets you receive up to an additional half of a scheduled award for a summer term, provided you are enrolled at least half time and have Pell eligibility remaining. It is not automatic at most schools: there is a summer aid application, and it is easy to miss because it appears on a different calendar from everything else.',
      'Which FAFSA year summer belongs to varies — some schools treat it as the tail of the year that is ending, some as the head of the one beginning. That decides which FAFSA has to be on file, and it is the first thing to establish rather than the last.',
      'Summer Pell counts against your lifetime eligibility like any other term, so it brings graduation closer and the end of your Pell closer at the same time. For a student close to finishing, that is usually a good trade. For one at the start of a long programme, it is worth doing the arithmetic.',
    ],
    checkYourself:
      'Your school decides whether summer is a header or a trailer term, what its summer aid application is, and when it closes. All three are local.',
    related: ['sap', 'why-less-aid', 'pell-drop-class'],
    variants: [
      'summer pell grant',
      'does financial aid cover summer',
      'financial aid for summer semester',
      'can i use fafsa for summer classes',
    ],
  },
  {
    id: 'dependency',
    slug: 'why-does-fafsa-need-my-parents-information',
    question: 'Why does my FAFSA still need my parents’ information?',
    category: 'fafsa',
    answer:
      'Because dependency is decided by a fixed list of questions, not by whether your parents support you or claim you on their taxes. Supporting yourself does not, on its own, make you independent.',
    body: [
      'You are independent for FAFSA purposes if you are 24 or older, married, a graduate student, a veteran or on active duty, have dependants you support, were in foster care or a ward of the court, were an emancipated minor or in legal guardianship, or are unaccompanied and homeless or at risk of it. If none of those apply, the form asks for parent information regardless of your living situation or who pays your rent.',
      'This is the rule students find hardest to accept, and the reason is that the alternative — self-declaration — would make need-based aid unmeasurable. It is a blunt instrument applied consistently rather than a judgement about your family.',
      'There is one route around it. If your circumstances are genuinely unusual — estrangement, abuse, abandonment, a parent who cannot be located — your aid office can grant a dependency override on documented evidence, usually a letter from somebody professionally acquainted with your situation. A parent simply refusing to pay or refusing to file is not grounds for it, though it may open a more limited option, so it is still worth the conversation.',
    ],
    checkYourself:
      'Only your school can grant a dependency override, case by case, and it must be requested each year. Bring documentation to that conversation rather than expecting to be believed on the strength of the account alone.',
    related: ['sai-meaning', 'verification', 'appeal'],
    variants: [
      "i'm independent why do i need parent info",
      'dependency status fafsa',
      "my parents don't support me fafsa",
      'can i file fafsa without my parents',
      'dependency override',
    ],
  },
];

export const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));
export const QUESTION_BY_SLUG = new Map(QUESTIONS.map((question) => [question.slug, question]));

export function questionById(id: string): Question | undefined {
  return QUESTION_BY_ID.get(id);
}

export function questionBySlug(slug: string): Question | undefined {
  return QUESTION_BY_SLUG.get(slug);
}
