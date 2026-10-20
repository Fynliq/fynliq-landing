// Tests for the production guard hook (.claude/hooks/guard.mjs). No network.
// Includes every bypass reported by the independent reviews of PR #18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBash, checkEdit, checkMcp, checkSql, decide, words, splitCommands } from '../.claude/hooks/guard.mjs';

const ON_FEATURE = { currentBranch: 'feat/x', upstream: 'origin/feat/x' };
const blocked = (cmd, ctx = ON_FEATURE) => assert.ok(checkBash(cmd, ctx), `expected BLOCK: ${cmd}`);
const allowed = (cmd, ctx = ON_FEATURE) => assert.equal(checkBash(cmd, ctx), null, `expected ALLOW: ${cmd}`);

test('shell parsing: quotes, escapes and separators', () => {
  assert.deepEqual(words(`git push origin "HEAD:main"`), ['git', 'push', 'origin', 'HEAD:main']);
  assert.deepEqual(words(`git push origin ma""in`), ['git', 'push', 'origin', 'main']);
  assert.deepEqual(words(`\\gh pr merge`), ['gh', 'pr', 'merge']);
  assert.deepEqual(splitCommands('a; b && c || d | e & f\ng'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(splitCommands(`echo "a;b" ; c`), ['echo "a;b"', 'c']);
});

test('pushes to protected branches are blocked in every spelling (including the reviewers\' bypasses)', () => {
  for (const cmd of [
    'git push origin main', 'git push origin HEAD:main', 'git push -u origin main', 'git push origin +main',
    'git push origin :main', 'git push --delete origin main', 'git push -d origin feat/connect-ask-backend',
    'git push -f origin main', 'git push --force-with-lease origin feat/connect-ask-backend',
    'git push origin HEAD:refs/heads/main', 'git push origin chore/x:feat/connect-ask-backend',
    'git push --mirror', 'git push --all origin', 'cd repo && git push origin main', 'FOO=1 git push origin main',
    // reviewers' bypasses:
    'git -C /home/claude/fynliq-landing push origin main', 'git -c k=v push origin main', 'git --no-pager push origin main',
    '/usr/bin/git push origin main', 'git push origin "feat/connect-ask-backend"', `git push origin 'HEAD:feat/connect-ask-backend'`,
    'git push origin HEAD:"main"', 'git push origin ma""in', 'bash -c "git push origin main"', 'sh -c \'git push origin main\'',
    'eval "git push origin main"', 'true & git push origin main', 'echo $(git push origin main)', 'echo `git push origin main`',
    'timeout 30 git push origin main', 'env -u X git push origin main', 'xargs git push origin < refs.txt main',
    'git push https://github.com/Fynliq/fynliq-landing HEAD:main',
  ]) blocked(cmd);
});

test('a bare push is blocked on a protected branch or when tracking one', () => {
  blocked('git push', { currentBranch: 'main' });
  blocked('git push origin', { currentBranch: 'feat/connect-ask-backend' });
  blocked('git push origin HEAD', { currentBranch: 'main' });
  blocked('git push', { currentBranch: 'feat/x', upstream: 'origin/main' });
  blocked('git push', { currentBranch: null });
});

test('git configuration that could redirect pushes is blocked', () => {
  for (const cmd of [
    'git config push.default upstream', 'git config --global push.default current', 'git config remote.origin.push refs/heads/*:refs/heads/main',
    'git config alias.p push', 'git config url.x.insteadOf y', 'git config core.hooksPath /tmp', 'git remote set-url origin x',
    'git remote add evil x', 'git branch -u origin/main', 'git branch --set-upstream-to=origin/feat/connect-ask-backend',
    'git checkout --track origin/main',
  ]) blocked(cmd);
  blocked('git p origin main', { ...ON_FEATURE, gitAlias: (name) => name === 'p' });
});

test('normal git work on feature branches is allowed', () => {
  allowed('git push -u origin feat/phase2-observability');
  allowed('git push');
  allowed('git push --force-with-lease origin chore/uptime-checks');
  allowed('git push origin main-ish-feature');
  allowed('git fetch origin main'); allowed('git merge origin/feat/connect-ask-backend');
  allowed('git -C /home/claude/fynliq-landing status'); allowed('git -C . log --oneline -3');
  allowed('git config --get remote.origin.url'); allowed('git config --add remote.origin.fetch +refs/heads/x:refs/remotes/origin/x');
  allowed('git checkout -b feat/new origin/feat/connect-ask-backend'); allowed('git commit -m "x"');
  allowed('S=$(git rev-parse HEAD); echo $S');
});

test('merging PRs is blocked through gh, flags, aliases, shells and the API', () => {
  for (const cmd of [
    'gh pr merge 16', 'gh pr merge --squash 16', 'gh -R Fynliq/fynliq-landing pr merge 18', 'gh --repo X pr merge 18',
    '"gh" pr merge 18', '\\gh pr merge 18', '/usr/bin/gh pr merge 18', 'bash -c "gh pr merge 18"', 'echo $(gh pr merge 18)',
    'gh alias set mm "pr merge"', 'gh mm 18', 'gh extension install x',
    'gh api -X PUT repos/Fynliq/fynliq-landing/pulls/16/merge',
    'gh api --method PUT /repos/Fynliq/fynliq-landing/pulls/16/merge',
    'gh api -q repos/a/b/issues -X PUT repos/Fynliq/fynliq-landing/pulls/18/merge',
    'gh api repos/Fynliq/fynliq-landing/merges -f base=main -f head=x',
    'gh api -X PUT repos/Fynliq/fynliq-landing/pulls/16/ccr/auto_merge',
    'gh api -X PUT repos/Fynliq/fynliq-landing/branches/main/protection --input p.json',
    'gh api -X PATCH repos/Fynliq/fynliq-landing -f default_branch=main',
    'gh api -X POST repos/Fynliq/fynliq-landing/git/refs -f ref=refs/heads/main -f sha=x',
    'gh api -X PUT repos/Fynliq/fynliq-landing/contents/x.js -f message=x',
    'gh api -X PUT repos/Fynliq/fynliq-landing/actions/secrets/X',
    'gh repo edit --default-branch main', 'gh secret set X', 'gh workflow disable Uptime', 'gh workflow run Nightly',
    'gh pr edit 16 --base main', 'gh api -X PATCH repos/Fynliq/fynliq-landing/pulls/16 -f base=main',
    'gh api graphql -f query="mutation { mergePullRequest(input:{}) { clientMutationId } }"', 'gh auth token',
    'curl -X PUT -H "Authorization: token x" https://api.github.com/repos/Fynliq/fynliq-landing/pulls/18/merge',
    'python3 -c "import subprocess; subprocess.run([\'gh\',\'pr\',\'merge\',\'18\'])"',
    "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['gh','pr','merge','18'])\nEOF",
    "node - <<'EOF'\nrequire('child_process').execSync('gh pr merge 18')\nEOF", 'node -e "require(\'child_process\').execSync(\'gh pr merge 18\')"',
  ]) blocked(cmd);
});

test('GitHub reads and the allowed writes (issues, comments, labels, PRs) pass', () => {
  allowed('gh api repos/Fynliq/fynliq-landing/pulls/16');
  allowed('gh api "repos/Fynliq/fynliq-landing/actions/runs?branch=x&per_page=5" --jq .total_count');
  allowed('J=$(gh api repos/Fynliq/fynliq-landing/actions/runs/1/jobs --jq \'.jobs[0].id\'); echo $J');
  allowed('gh api repos/Fynliq/fynliq-landing/pulls --input body.json');
  allowed('gh api -X PATCH repos/Fynliq/fynliq-landing/pulls/17 -f body=x');
  allowed('gh api repos/Fynliq/fynliq-landing/issues -f title=x -f body=y');
  allowed('gh api repos/Fynliq/fynliq-landing/issues/5/comments -f body=hi');
  allowed('gh api repos/Fynliq/fynliq-landing/issues/5/labels -f labels[]=agent:qa');
  allowed('gh api repos/Fynliq/fynliq-landing/pulls/17/reviews -f event=COMMENT -f body=ok');
  allowed('gh pr view 17'); allowed('gh issue list'); allowed('gh pr create --title x --body y --base feat/connect-ask-backend');
  allowed('gh -R Fynliq/fynliq-landing pr view 18'); allowed('gh run list'); allowed('gh auth status');
  allowed('gh api graphql -f query="{ viewer { login } }"');
});

test('production CLIs and direct API calls are blocked', () => {
  for (const cmd of [
    'vercel --prod', 'vercel deploy --prod', 'npx vercel promote dpl_1', 'npx -y vercel@latest --prod', 'vercel env pull',
    'vercel alias set a b', 'vercel rollback', 'vercel redeploy x', 'pnpm dlx vercel domains add x', 'vercel dns add',
    'supabase db push', 'npx supabase db push', 'supabase secrets set X=1', 'supabase functions deploy f',
    'supabase migration repair 1 --status applied', 'supabase link --project-ref abc', 'npx supabase@1.2.3 db push',
    'stripe refunds create --charge ch_1', 'npx stripe products list', 'stripe login',
    'curl -X POST https://api.stripe.com/v1/refunds -u sk_live_x:', 'curl https://api.vercel.com/v9/projects',
    'curl -X POST https://abc.supabase.co/rest/v1/rpc/x', 'psql "postgresql://u:p@db.abc.supabase.co:5432/postgres"',
    'wget https://api.github.com/repos/x/y', 'curl -X POST https://api.resend.com/emails',
  ]) blocked(cmd);
  allowed('vercel --version'); allowed('supabase --help'); allowed('curl -s https://www.fynliq.com/');
  allowed("python3 - <<'EOF'\np=open('x').read()\nopen('x','w').write(p.replace('a','b'))\nEOF");
  allowed('npm ci'); allowed('node --test test/guard.test.mjs'); allowed('python3 scripts/validate_ops.py');
});

test('local secret files are blocked; the example template is fine', () => {
  for (const cmd of ['cat .env', 'cat .env.local', 'less ./.env.production', 'source .env', 'grep KEY .env.local', 'cat .env*', 'cp .env.local /tmp/x'])
    blocked(cmd);
  allowed('cat .env.example'); allowed('git status'); allowed('git diff --stat');
});

test('the guard and its settings cannot be edited by agents', () => {
  for (const cmd of ['sed -i s/x/y/ .claude/hooks/guard.mjs', 'echo x > .claude/settings.json', 'rm .claude/hooks/guard.mjs',
    'cp /tmp/g.mjs .claude/hooks/guard.mjs', 'python3 -c "open(\'.claude/settings.json\',\'w\')"', 'mv .claude/settings.json x'])
    blocked(cmd);
  allowed('cat .claude/settings.json'); allowed('git diff .claude/hooks/guard.mjs'); allowed('node --test test/guard.test.mjs');
  const dir = '/home/claude/fynliq-landing';
  assert.ok(checkEdit('.claude/hooks/guard.mjs', dir));
  assert.ok(checkEdit(`${dir}/.claude/settings.json`, dir));
  assert.ok(checkEdit('.claude/settings.local.json', dir));
  assert.equal(checkEdit('.claude/agents/qa-agent.md', dir), null);
  assert.equal(checkEdit('src/App.tsx', dir), null);
  assert.ok(decide({ tool_name: 'Edit', tool_input: { file_path: `${dir}/.claude/hooks/guard.mjs` } }, { projectDir: dir }));
  assert.ok(decide({ tool_name: 'Write', tool_input: { file_path: `${dir}/.claude/settings.json` } }, { projectDir: dir }));
});

test('MCP: production servers are read-only by default, whatever the server is called', () => {
  for (const tool of [
    'mcp__Supabase__apply_migration', 'mcp__supabase__deploy_edge_function', 'mcp__Supabase__merge_branch',
    'mcp__claude_ai_Supabase__apply_migration', 'mcp__supabase-prod__apply_migration',
    'mcp__Stripe__stripe_api_write', 'mcp__Stripe__stripe_api_execute', 'mcp__Stripe__manage_stripe_accounts',
    'mcp__Vercel__request_promote', 'mcp__Vercel__assign_alias', 'mcp__Vercel__edit_project_env',
    'mcp__Vercel__create_deployment', 'mcp__Vercel__update_firewall_config', 'mcp__Vercel__get_project_env',
    'mcp__Vercel__some_future_tool', 'mcp__github__merge_pull_request', 'mcp__GitHub__create_or_update_file',
  ]) assert.ok(checkMcp(tool, {}), `expected BLOCK: ${tool}`);
  for (const tool of [
    'mcp__Supabase__list_tables', 'mcp__Supabase__get_advisors', 'mcp__Supabase__get_logs', 'mcp__Stripe__stripe_api_read',
    'mcp__Vercel__list_deployments', 'mcp__Vercel__get_runtime_logs', 'mcp__Vercel__create_observability_query',
    'mcp__Claude_Docs__batch', 'mcp__claude-code-remote__create_trigger', 'mcp__github__list_pull_requests',
  ]) assert.equal(checkMcp(tool, {}), null, `expected ALLOW: ${tool}`);
  assert.ok(checkMcp('mcp__claude_ai_Supabase__execute_sql', { query: 'delete from public.accounts' }));
  assert.ok(checkMcp('mcp__Vercel__list_projects', { decrypt: true }));
});

test('production SQL: only one call to an allow-listed aggregate function with literal arguments', () => {
  for (const q of [
    "select public.ops_milestone_metrics('')",
    "select public.ops_funnel(now() - interval '1 day', now(), 'source', '')",
    "select ops_health(now() - interval '1 hour', now());",
    "select public.billing_metrics('2026-01-01T00:00:00Z', '{}'::uuid[])",
    'select public.ops_applied_migrations()',
  ]) assert.equal(checkSql(q), null, `expected ALLOW: ${q}`);
  for (const q of [
    'select count(*) from public.accounts', 'select email from public.accounts', 'select * from public.accounts',
    "select public.analytics_record('[]'::jsonb)", 'select public.beta_guest(gen_random_uuid(), \'x\')',
    'select "billing_stripe_event"(1)', 'select public."api_request_record"(1)', 'select public.ops_funnel((select email from public.accounts limit 1), now(), \'none\', \'\')',
    'delete from public.accounts', 'update public.accounts set email = \'x\'', 'select 1; drop table public.accounts',
    'select pg_catalog.pg_terminate_backend(1)', "select pg_catalog.set_config('x','y',false)", 'select pg_sleep(100)',
    "select public.ops_health(E'\\x', now())", 'select public.ops_health(now(), now()) -- comment',
    "do $$ begin delete from public.accounts; end $$", 'explain analyze delete from public.accounts',
  ]) assert.ok(checkSql(q), `expected BLOCK: ${q}`);
});

test('decide() fails closed on unreadable input', () => {
  assert.ok(decide(null));
  assert.ok(decide({}));
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'x' } }), null);
});

test('the hook process exits 2 to block and 0 to allow', () => {
  const hook = fileURLToPath(new URL('../.claude/hooks/guard.mjs', import.meta.url));
  const run = (payload) => spawnSync(process.execPath, [hook], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
  const block = run({ tool_name: 'Bash', tool_input: { command: 'gh -R Fynliq/fynliq-landing pr merge 1' } });
  assert.equal(block.status, 2);
  assert.match(block.stderr, /production guard/);
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 0);
  assert.equal(run('not json').status, 2);
  assert.equal(run({ tool_name: 'mcp__Stripe__stripe_api_write', tool_input: {} }).status, 2);
});
