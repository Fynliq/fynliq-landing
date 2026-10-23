import { answerEarnRequest } from './sms-actions.js';
import { createSmsConsentStore } from './sms-consent-store.js';
import {
  parseTwilioForm, verifyTwilioSignature, handleEarnSms,
  xmlMessage,
} from './sms-earn.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

function parsedParams(body) {
  if (typeof body === 'string') return parseTwilioForm(body);
  if (Buffer.isBuffer(body)) return parseTwilioForm(body.toString('utf8'));
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const params = Object.create(null);
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'string') throw new Error('Invalid webhook field');
      params[key] = value;
    }
    if (Buffer.byteLength(JSON.stringify(params), 'utf8') > 16_384) throw new Error('Webhook too large');
    return params;
  }
  throw new Error('Unsupported webhook body');
}

export default async function inboundSms(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return res.status(415).end();
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.FYNLIQ_SMS_WEBHOOK_URL;
  const smsNumber = process.env.TWILIO_SMS_NUMBER;
  if (!authToken || !webhookUrl || !smsNumber) return res.status(503).end();
  let params;
  try {
    params = parsedParams(req.body);
  } catch {
    return res.status(400).end();
  }
  if (!verifyTwilioSignature({
    url: webhookUrl,
    params,
    signature: req.headers['x-twilio-signature'],
    authToken,
  })) return res.status(403).end();

  if (!/^\+1[2-9]\d{9}$/.test(params.From || '') || params.To !== smsNumber || typeof params.Body !== 'string') {
    return res.status(400).end();
  }

  try {
    const store = createSmsConsentStore().forPhone(params.From);
    const reply = await handleEarnSms({
      body: params.Body,
      getStatus: store.getStatus,
      setStatus: store.setStatus,
      getDealsStatus: store.getDealsStatus,
      setDealsStatus: store.setDealsStatus,
      answer: answerEarnRequest,
    });
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(xmlMessage(reply));
  } catch {
    // Fail closed on consent persistence failures, rather than process an
    // unverified opt-in or expose private implementation details.
    return res.status(503).end();
  }
}
