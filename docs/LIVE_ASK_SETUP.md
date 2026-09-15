# Live Ask on fynliq-beta-review

Target: Fynliq/fynliq-landing, production branch feat/search-tabs-gradi.

The existing Ask page now calls the same project's `/api/ask` in production. Local Vite development continues to use the existing composer unless VITE_FYNLIQ_ASK_URL is set. No new UI is substituted. Search and document analysis are unchanged.

## Vercel setup

In the existing fynliq-beta-review project, open Settings → Environment Variables. Add server-only OPENAI_API_KEY and OPENAI_MODEL to the deployment environment. Use a model available to the API account; the prior local backend used gpt-5.6-luna, whose access still needs verification. Do not prefix either setting with VITE_. Do not commit the key or a .env file.

Leave VITE_FYNLIQ_ASK_URL unset to use /api/ask, or explicitly set it to /api/ask. Remove any stale localhost/old-backend override. Redeploy after settings change. Keep deployment protection enabled for the review beta and configure Vercel Firewall request limits before opening to public traffic. The in-memory 10 requests/minute backstop is per instance and does not provide a global spending cap.

## Exact behavior

POST /api/ask receives `{question, analysis}` and returns the existing paragraphs/basis/grounding/missing/relatedIds contract. This first live service answers general questions only; analysis is not forwarded to OpenAI. The response always says basis=general, contains no citations, and explains that personalized document analysis is not connected yet. The endpoint never claims to have read uploaded documents.

Questions are trimmed and limited to 2,000 characters; request payloads are limited to 64 KB. Requests time out at the provider after 20 seconds. Keys and provider errors are never sent to the browser. Provider response storage is disabled; that setting is not a claim of zero provider retention.

The /ask path remains the React page. /api/ask is the backend function. Vercel routing checks files/functions before falling back to index.html, so the API is not swallowed by the single-page-app fallback.

## Verify

Run npm test and npm run build. Deploy the integration branch as a preview, confirm /ask renders, then submit one general question. Verify the answer badge says general, an answer appears, and no provider key is present in frontend assets. GET /api/ask should return 405, never index.html. Only then promote/merge into feat/search-tabs-gradi.

References: https://vercel.com/docs/functions/runtimes/node-js and https://developers.openai.com/api/docs/quickstart
