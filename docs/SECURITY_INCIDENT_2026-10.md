# Security incident: loader force-pushed into feature branches

| | |
|---|---|
| **Status** | Contained on `main`. Still active: branches were re-infected as late as 4 November 2026 |
| **First seen** | 30 September 2026 (`b53e1c5`, a rewritten copy of the PR #1 merge `a8e61c5`) |
| **Written** | 8 November 2026 |
| **`main`** | Clean. Never infected, never deployed from an infected commit |

## What happened

Something with push access to `Fynliq/fynliq-landing` rewrote the latest commit of feature branches and force-pushed them. Each rewrite keeps the original author, date and message, so the branch looks unchanged in the GitHub UI. Only the content differs. Every rewritten commit has a committer timezone of **-0700**, whatever the original author's timezone was. That is the best lead for finding the machine or token that pushed them.

It came back after the first clean-up: on 4 November three `cleanup/*` branches, which had been pushed clean on 23 October, were rewritten the same way with a newer version of the loader.

## The two variants

**Variant A** (from 30 Sept):
- `public/fonts/fa-solid.lfk`: obfuscated JavaScript posing as a font, hidden after 262 blank characters.
- `api.js`: the same, hidden after 315 blank characters.
- `package.json`: `dev` and `build` changed to `node api.js && …`.
- `.vscode/tasks.json` + `settings.json`: run the `.lfk` file silently when the folder is opened in VS Code (`runOn: folderOpen`, `task.allowAutomaticTasks: true`, hidden terminal).
- `.gitignore`: ignores `.gitignore`, `temp_auto_push.bat`, `temp_interactive_push.bat` and `branch_structure.json`. These are the files it uses to push itself into other repositories.

**Variant B** (from 26 Oct): everything in Variant A, plus:
- `init` (and `cloud/init`): about 13 KB of obfuscated code after 795 blank characters on line 33, run by `node init` in `dev`, `build` and `start`.
- `api/account.js`: obfuscated code after 266 blank characters on the handler line. This runs **inside the deployed serverless function**, not only at build time.
- `config.bat` added to `.gitignore`.

## Impact

- **Developer machines.** Anyone who opened an infected branch in VS Code, or ran `npm run dev` or `npm run build` on it, ran the loader with their own user rights. Treat those machines as compromised.
- **Vercel.** About 50 **Preview** deployments of infected commits (20 Oct to 4 Nov) built successfully. The loader ran on Vercel's build machines, and for Variant B on every request to `/api/account`. Preview environment variables were readable there:
  - `OPENAI_API_KEY` (all preview branches): **exposed**
  - `OLLAMA_API_KEY` (all preview branches, and per-branch copies for several infected branches): **exposed**
  - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `OPENAI_MODEL`: exposed, low sensitivity
  - Stripe secret and webhook keys and the Supabase service-role key exist for preview **only on `feat/connect-ask-backend`**, which was never infected.
- **Production.** No production deployment came from an infected commit. Production secrets were not exposed through Vercel. They may still have been exposed through a developer's local `.env*` files.

## Branch status (8 Nov)

Run `npm run test:guard -- origin/<branch>` for any branch. It reads files through git only and is safe on infected branches.

Infected, with the clean version to merge:

| Infected branch | Variant | Clean-up |
|---|---|---|
| `feat/login-newcomer-prompt` | A | `cleanup/feat-login-newcomer-prompt` |
| `fix/upload-consent-state` | A | `cleanup/fix-upload-consent-state` |
| `docs/frontend-ux-audit` | A | `cleanup/docs-frontend-ux-audit` |
| `feat/search-tabs-gradi` | A | `cleanup/feat-search-tabs-gradi` |
| `feature/fynq-ai-dataset-v1` | A | `cleanup/feature-fynq-ai-dataset-v1` |
| `fix/purchase-funnel-audit` | A | `cleanup/fix-purchase-funnel-audit` |
| `feat/phase2-observability` | A | `cleanup/feat-phase2-observability` |
| `feat/ollama-cloud-agent` | A | `cleanup/feat-ollama-cloud-agent` |
| `feat/budget-tab` | A | `cleanup/feat-budget-tab` |
| `feat/earn-ai-sms-pilot` | A | `cleanup/feat-earn-ai-sms-pilot` |
| `feat/crash-cash-sms-products` | A | `cleanup/feat-crash-cash-sms-products` |
| `feat/food-payments-sms-concierge` | A | `cleanup/feat-food-payments-sms-concierge` |
| `feat/exchange-mvp-oct26` | B | `cleanup/feat-exchange-mvp-oct26` |
| `feat/ai-cloud-gateway-foundation-20261026` | B | `cleanup/feat-ai-cloud-gateway-foundation-20261026` |

Every clean-up is a normal commit on top of the infected tip, so merging it is a fast-forward and rewrites no history. Each one changes only the loader files. Every other branch, including `main`, passes the guard.

## What was added in this PR

- `test/supply-chain-guard.mjs` (`npm run test:guard [ref]`): fails on any of the signatures above, and generally on code pushed off-screen behind 100+ blank characters, which is how both variants hide. It needs no dependencies and never executes branch content.
- `.github/workflows/supply-chain-guard.yml`: runs the guard on every push and pull request.

## Still to do (needs an owner)

1. **Find and clean the source machine.** Look for `temp_auto_push.bat`, `temp_interactive_push.bat`, `config.bat`, `branch_structure.json` and unknown `node` processes. Check any machine or CI job set to UTC-7. Until it is clean, branches will keep being re-infected.
2. **Rotate** `OPENAI_API_KEY` and `OLLAMA_API_KEY` now. Also rotate every secret that was in a local `.env*` on an affected machine, plus GitHub tokens and SSH keys, npm, Vercel and Stripe.
3. **GitHub → Settings → Branches → `main`:** require a pull request, require the `guard` check, and block force pushes. Apply the same to `cleanup/*` if possible.
4. **Vercel:** delete or protect the Preview deployments of infected commits, which still serve `/api/account`. Consider limiting automatic Preview deployments to branches with a passing `guard` check.
5. **VS Code, everyone:** set `"task.allowAutomaticTasks": "off"` in **user** settings, so a repository can never run a task on folder open.
6. After the merges, delete the infected branches and the now-redundant `recovery/*` branches.
