import { createHmac } from 'node:crypto';

/**
 * Stores only a keyed hash of the customer's inbound E.164 US number.
 * SMS does not prove ownership of a Fynliq account or financial records.
 */
export function createSmsConsentStore({
  supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  hashSecret = process.env.FYNLIQ_SMS_PHONE_HASH_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey || !hashSecret || hashSecret.length < 32) {
    throw new Error('SMS consent storage is not configured');
  }
  const base = new URL('/rest/v1/fynliq_sms_consent', supabaseUrl).toString();
  const headers = {
    apikey: serviceRoleKey,
    Authorization: 'Bearer ' + serviceRoleKey,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  function identity(from) {
    if (!/^\+1[2-9]\d{9}$/.test(from)) throw new Error('Unsupported SMS sender');
    return createHmac('sha256', hashSecret).update(from, 'utf8').digest('hex');
  }
  return {
    forPhone(from) {
      const phoneHash = identity(from);
      const query = '?phone_hash=eq.' + encodeURIComponent(phoneHash);
      async function getField(field) {
        const response = await fetchImpl(base + query + '&select=' + field, {
          method: 'GET', headers, signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Consent lookup failed');
        const data = await response.json();
        return Array.isArray(data) ? (data[0]?.[field] ?? null) : null;
      }
      return {
        getStatus: () => getField('state'),
        getDealsStatus: () => getField('deals_state'),
        async setStatus(state) {
          if (!['pending', 'active', 'opted_out'].includes(state)) throw new Error('Invalid consent state');
          const row = { phone_hash: phoneHash, state, updated_at: new Date().toISOString() };
          // One durable write suppresses ALL marketing when a customer opts out.
          if (state === 'opted_out') row.deals_state = 'opted_out';
          const response = await fetchImpl(base + '?on_conflict=phone_hash', {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(row),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error('Consent update failed');
        },
        async setDealsStatus(state) {
          if (!['pending', 'active', 'opted_out'].includes(state)) throw new Error('Invalid deals consent state');
          const response = await fetchImpl(base + query + '&select=deals_state', {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify({ deals_state: state, updated_at: new Date().toISOString() }),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error('Deals consent update failed');
          const rows = await response.json();
          if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.deals_state !== state) {
            throw new Error('Deals consent row missing or ambiguous');
          }
        },
      };
    },
  };
}
