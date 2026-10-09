// Tests for the production guard hook (.claude/hooks/guard.mjs). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBash, checkMcp, checkSql, decide } from '../.claude/hooks/guard.mjs';

const blocked = (cmd, ctx) => assert.ok(checkBash(cmd, ctx), `expected BLOCK: ${cmd}`);
const allowed = (cmd, ctx) => assert.equal(checkBash(cmd, ctx), null, `expected ALLOW: ${cmd}`);

test('pushes to protected branches are blocked in every spelling', () => {
  for (const cmd of [
    'git push origin main', 'git push origin HEAD:main', 'git push -u origin main', 'git push origin +main',
    'git push origin :main', 'git push --delete origin main', 'git push -d origin feat/connect-ask-backend',
    'git push -f origin main', 'git push --force-with-lease origin feat/connect-ask-backend',
    'git push origin HEAD:refs/heads/main', 'git push origin chore/x:feat/connect-ask-backend',
    'git push --mirror', 'git push --all origin', 'cd repo && git push origin main', 'FOO=1 git push origin main',
    'git -C . status; git push origin main',
  ]) blocked(cmd);
});

test('a bare push while on a protected branch is blocked', () => {
  blocked('git push', { currentBranch: 'main' });
  blocked('git push origin', { currentBranch: 'feat/connect-ask-backend' });
});

test('normal feature-branch pushes are allowed, including force-with-lease on your own branch', () => {
  allowed('git push -u origin feat/phase2-observability');
  allowed('git push', { currentBranch: 'chore/uptime-checks' });
  allowed('git push --force-with-lease origin chore/uptime-checks');
  allowed('git push origin main-ish-feature');
  allowed('git fetch origin main');
  allowed('git merge origin/feat/connect-ask-backend');
});

test('merging PRs is blocked through gh and the API', () => {
  for (const cmd of [
    'gh pr merge 16', 'gh pr merge --squash 16',
    'gh api -X PUT repos/Fynliq/fynliq-landing/pulls/16/merge',
    'gh api --method PUT /repos/Fynliq/fynliq-landing/pulls/16/merge',
    'gh api repos/Fynliq/fynliq-landing/merges -f base=main -f head=x',
    'gh api -X PUT repos/Fynliq/fynliq-landing/pulls/16/ccr/auto_merge',
    'gh api -X PUT repos/Fynliq/fynliq-landing/branches/main/protection --input p.json',
    'gh api -X DELETE repos/Fynliq/fynliq-landing/branches/main/protection',
    'gh api -X PATCH repos/Fynliq/fynliq-landing -f default_branch=main',
    'gh api -X PUT repos/Fynliq/fynliq-landing/actions/secrets/X',
    'gh repo edit --default-branch main', 'gh secret set X', 'gh workflow disable Uptime',
    'gh pr edit 16 --base main', 'gh api -X PATCH repos/Fynliq/fynliq-landing/pulls/16 -f base=main',
    'gh api graphql -f query="mutation { mergePullRequest(input:{}) { clientMutationId } }"',
  ]) blocked(cmd);
});

test('GitHub reads and the allowed writes (issues, comments, labels, PRs) pass', () => {
  allowed('gh api repos/Fynliq/fynliq-landing/pulls/16');
  allowed('gh api "repos/Fynliq/fynliq-landing/actions/runs?branch=x&per_page=5" --jq .total_count');
  allowed('gh api repos/Fynliq/fynliq-landing/pulls --input body.json');
  allowed('gh api -X PATCH repos/Fynliq/fynliq-landing/pulls/17 --input patch.json');
  allowed('gh api repos/Fynliq/fynliq-landing/issues -f title=x -f body=y');
  allowed('gh api repos/Fynliq/fynliq-landing/issues/5/comments -f body=hi');
  allowed('gh api repos/Fynliq/fynliq-landing/issues/5/labels -f labels[]=agent:qa-agent');
  allowed('gh api repos/Fynliq/fynliq-landing/pulls/17/reviews -f event=COMMENT -f body=ok');
  allowed('gh pr view 17'); allowed('gh issue list');
});

test('production CLIs and direct API calls are blocked', () => {
  for (const cmd of [
    'vercel --prod', 'vercel deploy --prod', 'npx vercel promote dpl_1', 'vercel env pull', 'vercel alias set a b',
    'vercel rollback', 'vercel redeploy x', 'pnpm dlx vercel domains add x', 'vercel dns add',
    'supabase db push', 'npx supabase db push', 'supabase secrets set X=1', 'supabase functions deploy f',
    'supabase migration repair 1 --status applied', 'supabase link --project-ref abc',
    'stripe refunds create --charge ch_1', 'npx stripe products list', 'stripe login',
    'curl -X POST https://api.stripe.com/v1/refunds -u sk_live_x:', 'curl https://api.vercel.com/v9/projects',
    'curl -X POST https://abc.supabase.co/rest/v1/rpc/x', 'psql "postgresql://u:p@db.abc.supabase.co:5432/postgres"',
  ]) blocked(cmd);
  allowed('vercel --version'); allowed('supabase --help'); allowed('curl -s https://www.fynliq.com/');
});

test('local secret files are blocked; the example template is fine', () => {
  blocked('cat .env'); blocked('cat .env.local'); blocked('less ./.env.production'); blocked('source .env');
  blocked('grep KEY .env.local');
  allowed('cat .env.example'); allowed('git status'); allowed('git diff --stat');
});

test('MCP write tools on production servers are blocked; reads pass', () => {
  for (const tool of [
    'mcp__Supabase__apply_migration', 'mcp__supabase__deploy_edge_function', 'mcp__Supabase__merge_branch',
    'mcp__Stripe__stripe_api_write', 'mcp__Stripe__manage_stripe_accounts',
    'mcp__Vercel__request_promote', 'mcp__Vercel__assign_alias', 'mcp__Vercel__edit_project_env',
    'mcp__Vercel__create_deployment', 'mcp__Vercel__update_firewall_config', 'mcp__Vercel__get_project_env',
    'mcp__Vercel__some_future_update_thing'.replace('some_future_', ''), 'mcp__Vercel__create_whatever_new',
  ]) assert.ok(checkMcp(tool, {}), `expected BLOCK: ${tool}`);
  for (const tool of [
    'mcp__Supabase__list_tables', 'mcp__Supabase__get_advisors', 'mcp__Supabase__get_logs', 'mcp__Stripe__stripe_api_read',
    'mcp__Vercel__list_deployments', 'mcp__Vercel__get_runtime_logs', 'mcp__Vercel__create_observability_query',
    'mcp__Claude_Docs__batch', 'mcp__claude-code-remote__create_trigger',
  ]) assert.equal(checkMcp(tool, {}), null, `expected ALLOW: ${tool}`);
});

test('production SQL must be a single read-only SELECT of allow-listed functions', () => {
  const ok = [
    'select public.ops_milestone_metrics(\'\')',
    "select public.ops_funnel(now() - interval '1 day', now(), 'source', '')",
    'select count(*) from public.accounts',
    'select event_name, count(*) from public.analytics_events group by 1 order by 2 desc limit 20;',
    'with x as (select date_trunc(\'day\', occurred_at) d, count(*) n from public.api_requests group by 1) select * from x',
    'select public.billing_metrics(now(), \'{}\')',
  ];
  for (const q of ok) assert.equal(checkSql(q), null, `expected ALLOW: ${q}`);
  const bad = [
    "select public.analytics_record('[]'::jsonb)", 'select public.beta_guest(gen_random_uuid(), \'x\')',
    'delete from public.accounts', 'update public.accounts set email = \'x\'', 'select 1; drop table public.accounts',
    'insert into public.analytics_events default values', 'alter table public.accounts disable row level security',
    'create policy p on public.accounts using (true)', 'grant select on public.accounts to anon',
    'select * into tmp from public.accounts', 'explain analyze delete from public.accounts',
    'set role postgres', 'copy public.accounts to stdout', 'select pg_sleep(100)', 'select set_config(\'x\', \'y\', false)',
    "do $$ begin delete from public.accounts; end $$", 'select public.record_upload(null,null,\'read\',1,1,null)',
  ];
  for (const q of bad) assert.ok(checkSql(q), `expected BLOCK: ${q}`);
  assert.ok(checkMcp('mcp__Supabase__execute_sql', { query: 'delete from public.accounts' }));
  assert.equal(checkMcp('mcp__Supabase__execute_sql', { query: 'select public.ops_health(now() - interval \'1 hour\', now())' }), null);
});

test('decide() fails closed on unreadable input', () => {
  assert.ok(decide(null));
  assert.ok(decide({}));
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'x' } }), null);
});

test('the hook process exits 2 to block and 0 to allow', () => {
  const hook = fileURLToPath(new URL('../.claude/hooks/guard.mjs', import.meta.url));
  const run = (payload) => spawnSync(process.execPath, [hook], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
  const block = run({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 1' } });
  assert.equal(block.status, 2);
  assert.match(block.stderr, /production guard/);
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 0);
  assert.equal(run('not json').status, 2);
  assert.equal(run({ tool_name: 'mcp__Stripe__stripe_api_write', tool_input: {} }).status, 2);
});
