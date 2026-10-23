/**
 * Food + money SMS concierge (intent / handoff only).
 *
 * No third-party purchase, payment, account login or bank transfer happens
 * in this module. Consumer food APIs require approved partnerships.
 *
 * Instacart Developer Platform can optionally create a shopping-list link.
 * The customer independently picks a merchant, checks prices and pays on
 * Instacart. Server-only key never enters text replies.
 */

export const FOOD_PROVIDERS = Object.freeze({
  doordash: Object.freeze({ name: 'DoorDash', url: 'https://www.doordash.com/' }),
  ubereats: Object.freeze({ name: 'Uber Eats', url: 'https://www.ubereats.com/' }),
  grubhub: Object.freeze({ name: 'Grubhub', url: 'https://www.grubhub.com/' }),
  instacart: Object.freeze({ name: 'Instacart', url: 'https://www.instacart.com/' }),
});

const LIST_HELP = 'Text GROCERY LIST: milk, eggs, rice (max 8 non-sensitive items). With a linked Instacart developer account, Fynliq can prepare a shopping list for you to review. No order is placed.';

function safeInstacartLink(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username && !url.password
      && (host === 'instacart.com' || host.endsWith('.instacart.com'))
      ? url.href : null;
  } catch {
    return null;
  }
}

export function parseGroceryList(message) {
  const match = /^GROCERY LIST\s*:\s*([^\r\n]{1,440})$/i.exec(String(message || '').trim());
  if (!match) return null;
  const items = match[1].split(',').map(x => x.trim().replace(/\s+/g, ' '));
  if (items.length < 1 || items.length > 8
    || items.some(x => x.length < 2 || x.length > 45 || /[<>{}]/.test(x))) return null;
  return items;
}

/**
 * Optional server-to-server Instacart developer integration. No checkout,
 * no order creation, and no credit-card data involved.
 */
export async function instacartListReply(message, {
  apiKey = process.env.INSTACART_API_KEY,
  environment = process.env.INSTACART_API_ENV || 'production',
  fetchImpl = fetch,
} = {}) {
  const items = parseGroceryList(message);
  if (!items) return LIST_HELP;
  if (!apiKey) {
    return 'Your grocery list has ' + items.length + ' items. Instacart list-link API is not connected to Fynliq yet. Shop and confirm your own order: ' + FOOD_PROVIDERS.instacart.url + ' No order or payment was made.';
  }
  if (!['development', 'production'].includes(environment)) {
    return 'Grocery-list integration is unavailable. No order or charge occurred.';
  }
  const endpoint = (environment === 'development'
    ? 'https://connect.dev.instacart.tools'
    : 'https://connect.instacart.com') + '/idp/v1/products/products_link';
  try {
    const result = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        title: 'Fynliq Grocery List',
        link_type: 'shopping_list',
        line_items: items.map(name => ({ name })),
      }),
      signal: AbortSignal.timeout(7500),
    });
    if (!result.ok) throw new Error('Instacart link request rejected');
    const payload = await result.json();
    const link = safeInstacartLink(payload?.products_link_url);
    if (!link) throw new Error('Untrusted Instacart link');
    return 'Fynliq prepared a shopping list of ' + items.length + ' items. Choose a store, review prices and pay directly on Instacart: ' + link + ' No order or charge was made by Fynliq.';
  } catch {
    return 'Instacart list-link service is unavailable. No order was placed or charged. You can shop directly at ' + FOOD_PROVIDERS.instacart.url;
  }
}

function providerHandoff(provider) {
  const name = FOOD_PROVIDERS[provider].name;
  const url = FOOD_PROVIDERS[provider].url;
  return 'Open ' + name + ' to select food, see live prices and delivery fees, and confirm payment yourself: ' + url + ' Fynliq has NOT placed an order or charged you.';
}

const MONEY_REPLY = 'Fynliq cannot charge a card, send money, transfer funds, or pay bills by SMS yet. No payment or transfer occurred. Future payments require secure account setup, a real quote, explicit approval, and provider-confirmed receipts. Never text card/bank details or passcodes.';

export async function foodMoneyReply(message, options) {
  const text = String(message || '').trim();
  const cmd = text.toUpperCase();
  if (/^GROCERY LIST(?:\s*:|$)/i.test(text)) return instacartListReply(text, options);
  if (/^(?:ORDER FOOD|FOOD DELIVERY|DELIVERY FOOD|DELIVERY MENU|ORDER DELIVERY|DELIVERY)$/.test(cmd)) {
    return 'Food delivery choices: text DOORDASH, UBER EATS or GRUBHUB. For groceries text INSTACART or GROCERY LIST: milk, eggs, rice. All checkouts remain with the provider; Fynliq cannot pay or order yet.';
  }
  if (/^(?:DOORDASH|DOOR DASH)$/.test(cmd) || /^ORDER (?:FROM )?DOORDASH\b/.test(cmd)) {
    return providerHandoff('doordash');
  }
  if (/^(?:UBEREATS|UBER EATS)$/.test(cmd) || /^ORDER (?:FROM )?UBER EATS\b/.test(cmd)) {
    return providerHandoff('ubereats');
  }
  if (/^GRUBHUB$/.test(cmd) || /^ORDER (?:FROM )?GRUBHUB\b/.test(cmd)) {
    return providerHandoff('grubhub');
  }
  if (/^(?:INSTACART|GROCERIES|GROCERY DELIVERY|ORDER GROCERIES)$/.test(cmd)) {
    return providerHandoff('instacart');
  }
  if (/^(?:MONEY|MONEY SERVICES|PAYMENTS|PAYMENT SERVICES)$/.test(cmd)) {
    return 'Money tools: Text BUDGET for a self-reported cash-flow check, AID for assistance, WORK for income options, PAYOUT for actual verified earnings status. Transfers and bill payments are NOT active.';
  }
  if (/^(?:SEND MONEY|SEND \$.+|TRANSFER(?:\s|$)|WIRE(?:\s|$)|PAY BILL(?:\s|$)|PAY NOW|CHECKOUT|CHARGE (?:ME|MY CARD)|BOOK AND PAY|CONFIRM ORDER|PLACE ORDER|ORDER STATUS|PAYMENT STATUS)(?:.*)$/i.test(text)) {
    return MONEY_REPLY;
  }
  return null;
}
