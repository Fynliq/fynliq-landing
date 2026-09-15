# Document-based answers in the review beta

Repository: Fynliq/fynliq-landing. Integration branch: feat/connect-ask-backend.
Preview: https://fynliq-landing-git-feat-connect-ask-backend-fynq.vercel.app/beta

## Server settings

In FYNQ / fynliq-landing, add OPENAI_API_KEY and OPENAI_MODEL as server-only environment variables for Preview. The local API account successfully tested gpt-5.6-luna. Never use a VITE_ prefix for secrets, commit an .env file, or put credentials in frontend settings. Redeploy after setting variables. Leave VITE_FYNLIQ_ANALYZE_URL and VITE_FYNLIQ_ASK_URL unset to use same-origin /api/analyze and /api/ask.

## Upload and review contract

POST /api/analyze accepts JSON {consent:true,files:[{name,type,data}]} where data is base64, with 1–3 PDF/PNG/JPEG/WEBP files totaling at most 2,800,000 decoded bytes. Both frontend and server enforce limits; server also checks file signatures. Documents are sent to OpenAI with storage disabled. This does not eliminate provider retention policies. Fynliq does not persist uploaded files or extracted reads in a database or browser storage.

The reader extracts facts from FAFSA Submission Summaries, award letters and student account statements, preserving document number, page, quotation, period and estimate labels. Unreadable, conflicting or unsupported results are rejected. The existing AidAnalysis response adds summaryFacts and a one-hour signed summaryToken; empty award lines are allowed for this review flow. Missing fields are never converted into zero-valued awards or bills.

Students compare the extracted fields against originals and confirm before personal answers. The summary stays in React memory across My Aid, Search and Ask; refresh clears it. Signed summaries expire after one hour. This signature prevents client edits to the extracted facts; it does not prove that AI extraction is accurate.

## Answer contract

POST /api/ask accepts {question,analysis:null} for general answers, or {question,analysis:{reviewed:true,summaryToken}} for personal answers. It returns {paragraphs,basis,grounding,missing,relatedIds}. Questions are limited to 2,000 characters; the route has a 64 KB payload cap. Only verified signed facts go to the provider; client-submitted financial fields are ignored.

My Aid has a detailed explanation action, Search has a personal answer action for the entered or selected question, and Ask uses the same service. Personal answers include source quotations. Unknown fact references and unsupported dollar amounts are rejected. Missing details are explained instead of invented. Review and automated checks reduce errors but cannot guarantee semantic accuracy. School confirmation is still needed for final aid, deadlines and refunds.

## Validation and deployment

191 automated tests passed and the production bundle built successfully during implementation. A real-provider smoke test with three fictional PDF documents extracted nine expected fields and answered an overview, balance question and missing refund-date question with citations. No real student records were used.

The per-instance in-memory limits (3 uploads and 10 questions per minute per IP) are only backstops, not global abuse or spending controls. Use deployment protection and appropriate Vercel Firewall and provider spending controls for the beta before inviting public traffic. No authentication, saved student history or durable document storage is implemented.

Verify the deployed preview after its server variables are configured: upload fictional documents, review facts, request an overview, navigate through Search and Ask without refreshing, and check source references. /api/ask and /api/analyze must respond as functions, not index.html. Production promotion is separate from preview validation.
