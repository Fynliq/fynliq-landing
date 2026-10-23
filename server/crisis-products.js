/**
 * Fynliq Crisis Cash tools: deterministic, privacy-first SMS help.
 *
 * These are informational resources and calculation/drafting tools only.
 * No eligibility claims, verified job openings, bank account access, benefit
 * applications or payouts are made from this module.
 */

const RESOURCES = Object.freeze({
  benefits: 'https://www.usa.gov/benefits',
  support: 'https://www.211.org/',
  jobSearch: 'https://www.careeronestop.org/',
});

const TOP_LEVEL = 'Fynliq Crisis Cash: Text AID for assistance, WORK for earning options, BILL RENT/UTILITY/CARD for hardship scripts, BUDGET income essentials other for a cash-flow check, or PAYOUT for payment status. No guaranteed cash.';

function financialResource(type) {
  switch (type) {
    case 'FOOD':
      return 'Food help: Explore SNAP, WIC and emergency food through ' + RESOURCES.benefits + '. You can also dial 211 or use ' + RESOURCES.support + ' for nearby services. Approval depends on the agency.';
    case 'RENT':
      return 'Housing/rent help: Try local housing assistance through ' + RESOURCES.benefits + ' and dial 211 or visit ' + RESOURCES.support + '. No funding or eligibility has been verified.';
    case 'UTILITIES':
      return 'Utility bill help: Review energy/utility assistance at ' + RESOURCES.benefits + ' or dial 211 / visit ' + RESOURCES.support + '. Ask your provider about hardship plans.';
    case 'AID':
      return 'Emergency assistance: For food, housing, utilities and government benefits, visit ' + RESOURCES.benefits + '. For local nonprofit support dial 211 or visit ' + RESOURCES.support + '. Assistance is not guaranteed.';
    default:
      return null;
  }
}

function billScript(category) {
  if (!['RENT', 'UTILITY', 'UTILITIES', 'CARD', 'PHONE', 'MEDICAL'].includes(category)) {
    return 'Choose BILL RENT, BILL UTILITY, BILL CARD, BILL PHONE or BILL MEDICAL. I can draft a hardship request; I cannot negotiate or change the bill yet.';
  }
  const recipient = ({
    RENT: 'landlord or property manager',
    UTILITY: 'utility provider', UTILITIES: 'utility provider',
    CARD: 'card issuer', PHONE: 'phone provider',
    MEDICAL: 'billing office',
  })[category];
  return 'Draft to ' + recipient + ': "I am facing financial hardship and want to keep my account in good standing. Do you offer an affordable payment plan, hardship assistance or fee relief? Please share terms in writing." Nothing was sent.';
}

function dollars(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCents(input) {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fractional = ''] = input.split('.');
  return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}

export function budgetReply(value) {
  const match = /^BUDGET\s+(\S+)\s+(\S+)\s+(\S+)$/i.exec(value);
  if (!match) return 'Text BUDGET <monthly take-home pay> <essential bills> <other spending>. Example: BUDGET 1600 1200 250. Use totals, not account numbers.';
  const [income, essentials, other] = match.slice(1).map(parseCents);
  if ([income, essentials, other].some((x) => x === null)) {
    return 'Use positive dollar totals up to 9999999 with at most 2 decimals. Do NOT text bank details, card numbers or passwords.';
  }
  const available = income - essentials - other;
  if (available < 0) {
    return 'Self-reported monthly gap: ' + dollars(-available) + '. Income ' + dollars(income) + '; essential bills ' + dollars(essentials) + '; other spending ' + dollars(other) + '. Text AID or BILL RENT/UTILITY/CARD for next steps. No account linked.';
  }
  return 'Self-reported monthly remainder: ' + dollars(available) + '. Income ' + dollars(income) + '; essentials ' + dollars(essentials) + '; other spending ' + dollars(other) + '. Keep a buffer for irregular expenses. No account linked.';
}

export function crisisCashReply(message) {
  const text = String(message || '').trim();
  const command = text.toUpperCase();
  if (command === 'CRISIS' || command === 'SURVIVE' || command === 'CASH HELP') return TOP_LEVEL;
  if (command === 'AID' || command === 'BENEFITS' || command === 'HELP CASH' || command === 'RELIEF') return financialResource('AID');
  if (command === 'FOOD' || command === 'RENT' || command === 'UTILITIES') return financialResource(command);
  if (command === 'WORK' || command === 'JOBS') {
    return 'Looking for income? Find authorized job listings and local American Job Centers at ' + RESOURCES.jobSearch + '. Or use TASK CAPTION/LISTING/REPLY to draft approved client work. Fynliq has not applied, hired or earned for you.';
  }
  if (command === 'PAYOUT' || command === 'MY EARNINGS' || command === 'BALANCE') {
    return 'No verified Fynliq task payouts are connected yet. Fynliq has not sent money to your bank. We will show paid earnings only after real buyer payments and provider-confirmed transfers.';
  }
  if (command === 'SCAM' || command === 'SAFE') {
    return 'Safety: Do not pay an employer to unlock a job, send one-time codes, or share bank passwords by SMS. Verify employers and assistance agencies independently. Fynliq cannot guarantee income or benefits.';
  }
  if (command === 'TIKTOK') {
    return 'TikTok income analytics are not yet connected to Fynliq SMS. No creator revenue has been verified; avoid sharing login details over text.';
  }
  if (/^BILL(?:\s|$)/i.test(text)) {
    const category = /^BILL\s+([A-Z]+)$/i.exec(text)?.[1]?.toUpperCase() || '';
    return billScript(category);
  }
  if (/^BUDGET(?:\s|$)/i.test(text)) return budgetReply(text);
  return null;
}
