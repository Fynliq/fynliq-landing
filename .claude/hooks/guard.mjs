#!/usr/bin/env node
// FYNQ production guard: a Claude Code PreToolUse hook.
//
// Hooks run in every permission mode (auto-approve and bypass included). This
// one blocks a tool call by exiting 2 with a reason on stderr. It is defense in
// depth, not a proof: a determined program can always find a way around text
// checks. The hard stops live outside the agent (GitHub branch protection with a
// required review from another account; a read-only Supabase connector). See
// docs/agent-system.md "Enforcement".
//
// Policy: deny by default for the commands that can reach production or GitHub
// (git push/config/remote, gh, vercel, supabase, stripe, curl/wget to provider
// APIs, psql to production), unwrap shells and wrappers before checking, and
// protect this guard and the settings that load it from being edited.
//
// Fails closed: unreadable input or an internal error blocks the call.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROTECTED_BRANCHES = ['main', 'feat/connect-ask-backend'];

// ------------------------------------------------------------ tokenizing

/** Splits shell text into simple commands, respecting quotes. */
export function splitCommands(text) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(text || '').replace(/\\\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Shell-like word splitting: removes quotes and backslash escapes. */
export function words(command) {
  const out = [];
  let cur = '';
  let has = false;
  let q = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Inner command strings hidden in $(...), backticks, <(...) . */
function substitutions(text) {
  const found = [];
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    if ((s[i] === '$' || s[i] === '<' || s[i] === '>') && s[i + 1] === '(') {
      let depth = 0;
      for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')' && --depth === 0) { found.push(s.slice(i + 2, j)); break; }
      }
    }
  }
  for (const m of s.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

const base = (w) => path.posix.basename(String(w || '').replace(/^\\/, '')).replace(/@[^/\s]*$/, '');

// Wrappers whose following words are another command.
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'builtin', 'nice', 'ionice', 'stdbuf',
  'timeout', 'xargs', 'npx', 'bunx', 'pnpx', 'doas', 'chronic', 'unbuffer', 'setsid', 'caffeinate']);
const WRAPPER_PAIRS = [['pnpm', 'dlx'], ['pnpm', 'exec'], ['yarn', 'dlx'], ['npm', 'exec'], ['npm', 'x']];

/** Drops env assignments and wrappers; returns the words of the real command. */
export function unwrap(ws) {
  let w = [...ws];
  for (let guard = 0; guard < 20 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w.shift(); continue; }
    const pair = WRAPPER_PAIRS.find(([a, b]) => base(w[0]) === a && w[1] === b);
    if (pair) { w = w.slice(2); while (w.length && w[0].startsWith('-')) w.shift(); continue; }
    const b = base(w[0]);
    if (WRAPPERS.has(b)) {
      w.shift();
      // Skip the wrapper's own options and their values (timeout 5, nice -n 5, env -u X, xargs -n 1 ...).
      while (w.length && (w[0].startsWith('-') || /^\d+[smhd]?$/.test(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
        const opt = w.shift();
        if (/^-(n|u|I|P|L|s|p|-package|k|-kill-after|-signal)$/.test(opt) && w.length && !/^-/.test(w[0])) w.shift();
      }
      continue;
    }
    break;
  }
  return w;
}

// ------------------------------------------------------------------- git

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix']);

function gitParse(ws) {
  let i = 1;
  let dir = null;
  while (i < ws.length && ws[i].startsWith('-')) {
    const o = ws[i];
    if (GIT_OPTS_WITH_VALUE.has(o)) { if (o === '-C') dir = ws[i + 1]; i += 2; continue; }
    if (o.startsWith('--git-dir=') || o.startsWith('--work-tree=')) { i += 1; continue; }
    i += 1;
  }
  return { sub: ws[i], args: ws.slice(i + 1), dir };
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch { return null; }
}

const strip = (ref) => String(ref || '').replace(/^\+/, '').replace(/^refs\/heads\//, '').replace(/^origin\//, '');

function gitPushProblem(args, ctx) {
  if (args.some((a) => a === '--mirror' || a === '--all' || a === '--prune')) return 'git push --mirror/--all/--prune is not allowed.';
  const deleting = args.some((a) => a === '-d' || a === '--delete');
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo' || a === '-o' || a === '--push-option' || a === '--receive-pack' || a === '--exec') { i++; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const refspecs = positional.slice(1);
  for (const spec of refspecs) {
    let dest = spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec;
    if (dest === '' && spec.startsWith(':')) dest = spec.slice(1);
    dest = strip(dest);
    if (dest === 'HEAD' || dest === '@') dest = ctx.currentBranch || 'HEAD';
    if (PROTECTED_BRANCHES.includes(dest)) return `Pushing to or deleting the protected branch "${dest}" is not allowed.`;
    if (deleting && PROTECTED_BRANCHES.includes(strip(spec))) return `Deleting "${spec}" is not allowed.`;
  }
  if (!refspecs.length) {
    if (ctx.currentBranch && PROTECTED_BRANCHES.includes(ctx.currentBranch)) return `You are on the protected branch "${ctx.currentBranch}"; a bare git push would push to it.`;
    if (ctx.upstream && PROTECTED_BRANCHES.includes(strip(ctx.upstream))) return `This branch tracks "${ctx.upstream}"; a bare git push could push to a protected branch.`;
    if (!ctx.currentBranch) return 'Could not tell which branch a bare git push would update; name the branch explicitly.';
  }
  return null;
}

function gitProblem(ws, ctx) {
  const { sub, args, dir } = gitParse(ws);
  const here = dir ? { ...ctx, ...ctx.inspect(dir) } : ctx;
  if (!sub) return null;
  if (sub === 'push') return gitPushProblem(args, here);
  if (sub === 'send-pack' || sub === 'http-push') return `git ${sub} is not allowed.`;
  if (sub === 'config') {
    const text = args.join(' ');
    if (/(^|\s)(--get|--get-all|--get-regexp|-l|--list|--show-origin)(\s|$)/.test(text) && !/(^|\s)(--add|--replace-all|--unset)/.test(text)) return null;
    if (/(^|\s|\.)(push\.|remote\.[^\s]*\.(push|url|pushurl|mirror)|url\.[^\s]*\.(insteadof|pushinsteadof)|branch\.[^\s]*\.(merge|remote|pushremote)|alias\.|core\.hookspath|include\.|includeif\.)/i.test(text)) {
      return 'Changing git push, remote, alias, hook or include configuration is not allowed.';
    }
    return null;
  }
  if (sub === 'remote' && /^(add|set-url|rename|remove|rm|set-branches)$/.test(args[0] || '')) return 'Changing git remotes is not allowed.';
  if (sub === 'branch' && args.some((a) => /^(-u|--set-upstream-to(=.*)?|--track|-t)$/.test(a) || a.startsWith('--set-upstream-to='))) {
    const target = args.find((a, i) => i > 0 && /^(-u|--set-upstream-to)$/.test(args[i - 1])) || (args.find((a) => a.startsWith('--set-upstream-to=')) || '').split('=')[1];
    if (!target || PROTECTED_BRANCHES.includes(strip(target))) return 'Setting a branch to track a protected branch is not allowed.';
  }
  if (sub === 'checkout' || sub === 'switch') {
    const ti = args.findIndex((a) => a === '--track' || a === '-t');
    if (ti >= 0 && PROTECTED_BRANCHES.includes(strip(args[ti + 1] || ''))) return 'Tracking a protected branch is not allowed.';
  }
  // A git alias can hide any of the above.
  if (!/^(status|log|diff|show|add|commit|fetch|pull|merge|rebase|checkout|switch|branch|stash|reset|restore|rev-parse|ls-files|ls-remote|remote|tag|cherry-pick|revert|blame|grep|clean|init|clone|worktree|config|mv|rm|describe|shortlog|reflog|format-patch|apply|am|bisect|notes|submodule|show-ref|for-each-ref|cat-file|rev-list|merge-base|name-rev|check-ignore|var|help|version|gc|fsck|count-objects|archive|sparse-checkout|symbolic-ref|update-index|write-tree|read-tree|hash-object|ls-tree|diff-tree|range-diff|whatchanged|maintenance)$/.test(sub)) {
    if (ctx.gitAlias(sub, dir)) return `git alias "${sub}" is not allowed (aliases can hide pushes).`;
  }
  return null;
}

// -------------------------------------------------------------------- gh

// Writes allowed through `gh api`: issues, comments, labels, reviews, opening a
// PR and editing a PR's title/body. Everything else that writes is blocked.
const GH_WRITE_ALLOWED = [
  /^\/?repos\/[^/\s]+\/[^/\s]+\/issues(\/\d+(\/(comments|labels(\/[^/\s]+)?))?)?$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/issues\/comments\/\d+$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/labels(\/[^/\s]+)?$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls\/\d+$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls\/\d+\/(comments|reviews|requested_reviewers)$/,
];
const GH_API_OPTS_WITH_VALUE = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '-q', '--jq',
  '-t', '--template', '--input', '-p', '--preview', '--hostname', '--cache']);

function ghApiProblem(args) {
  let method = null;
  let hasBody = false;
  let endpoint = null;
  const fields = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.match(/^(--?[A-Za-z-]+)=(.*)$/);
    const name = eq ? eq[1] : a;
    const value = eq ? eq[2] : args[i + 1];
    if (GH_API_OPTS_WITH_VALUE.has(name)) {
      if (name === '-X' || name === '--method') method = String(value || '').toUpperCase();
      if (['-f', '--raw-field', '-F', '--field', '--input'].includes(name)) { hasBody = true; fields.push(String(value || '')); }
      if (!eq) i++;
      continue;
    }
    if (/^-X[A-Za-z]+$/.test(a)) { method = a.slice(2).toUpperCase(); continue; }
    if (a.startsWith('-')) continue;
    if (endpoint === null) endpoint = a;
  }
  const ep = String(endpoint || '').split('?')[0].replace(/^https:\/\/api\.github\.com/, '');
  if (!ep) return 'gh api without an endpoint is not allowed.';
  if (/^\/?graphql$/.test(ep)) {
    return fields.some((f) => /mutation/i.test(f)) || hasBody && !fields.length ? 'GitHub GraphQL mutations are not allowed.' : null;
  }
  if (/\/merges?(\/|$)|auto_merge|\/protection|\/rulesets|\/actions\/(secrets|variables|permissions|workflows\/[^/]+\/(enable|disable|dispatches))|\/environments|\/collaborators|\/invitations|\/hooks|\/keys|\/branches\/[^/]+\/rename|\/transfer|\/git\/refs|\/contents\//.test(ep)) {
    return `GitHub API endpoint "${ep}" is human-only (merges, branch protection, refs, contents, secrets, workflows, settings).`;
  }
  const m = method || (hasBody ? 'POST' : 'GET');
  if (m === 'GET' || m === 'HEAD') return null;
  if (GH_WRITE_ALLOWED.some((re) => re.test(ep))) {
    if (/\/pulls\/\d+$/.test(ep) && fields.some((f) => /^base=/.test(f))) return 'Changing a PR base branch is human-only.';
    if (/\/pulls\/\d+$/.test(ep) && args.includes('--input')) return 'Editing a PR from a file is not allowed (it could change the base); use -f title=/body=.';
    if (m === 'DELETE' && !/labels\//.test(ep)) return 'Deleting GitHub resources is not allowed.';
    if (m === 'PUT') return `GitHub API PUT ${ep} is not allowed.`;
    return null;
  }
  return `GitHub API ${m} ${ep} is not on the allow-list (issues, comments, labels, reviews, opening/editing PRs).`;
}

const GH_ALLOWED = {
  pr: /^(view|list|diff|checks|status|create|comment|review|edit|ready|close|reopen|checkout)$/,
  issue: /^(view|list|status|create|comment|edit|close|reopen|develop)$/,
  run: /^(list|view|watch|download)$/,
  workflow: /^(list|view)$/,
  repo: /^(view|list|clone)$/,
  release: /^(list|view|download)$/,
  label: /^(list|create|clone)$/,
  auth: /^(status)$/,
  search: /.*/, browse: /.*/, status: /.*/, cache: /^(list)$/, help: /.*/, version: /.*/,
};

function ghProblem(ws) {
  let i = 1;
  while (i < ws.length && ws[i].startsWith('-')) {
    if (ws[i] === '-R' || ws[i] === '--repo' || ws[i] === '--hostname') i += 2; else i += 1;
  }
  const sub = ws[i];
  const args = ws.slice(i + 1);
  if (!sub) return null;
  if (sub === '--version' || sub === '--help') return null;
  if (sub === 'api') return ghApiProblem(args.filter((a, k) => !(a === '-R' || a === '--repo') && !(k > 0 && (args[k - 1] === '-R' || args[k - 1] === '--repo'))));
  const rule = GH_ALLOWED[sub];
  if (!rule) return `"gh ${sub}" is not on the allow-list (merges, settings, secrets, aliases and extensions are human-only).`;
  const action = args.find((a) => !a.startsWith('-')) || '';
  if (sub !== 'search' && sub !== 'browse' && sub !== 'status' && sub !== 'help' && sub !== 'version' && !rule.test(action)) {
    return `"gh ${sub} ${action}" is not on the allow-list.`;
  }
  if (sub === 'pr' && action === 'edit' && args.some((a) => a === '--base' || a === '-B' || a.startsWith('--base='))) return 'Changing a PR base branch is human-only.';
  if (sub === 'pr' && action === 'merge') return 'Merging PRs is human-only.';
  return null;
}

// ---------------------------------------------------------- other tools

const PROVIDER_HOSTS = /(api\.github\.com|github\.com\/[^/\s]+\/[^/\s]+\/(pull|merge)|api\.stripe\.com|api\.vercel\.com|vercel\.com\/api|supabase\.co|supabase\.com|pooler\.supabase|api\.resend\.com)/i;
const GUARDED_PATHS = /(^|[\s'"=/])\.claude\/(hooks\/|settings(\.local)?\.json)/;
const READ_ONLY_CMDS = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'rg', 'ls', 'wc', 'diff', 'stat', 'file', 'sha256sum', 'shasum', 'md5sum', 'jq']);
const SECRET_FILE = /(^|\/)\.env(\.[^/\s]*|\*)?$/;

function commandProblem(ws, ctx, raw) {
  const w = unwrap(ws);
  if (!w.length) return null;
  const cmd = base(w[0]);
  const rest = w.slice(1);

  // Self-protection: this guard and the settings that load it.
  if (GUARDED_PATHS.test(raw)) {
    const readOnly = READ_ONLY_CMDS.has(cmd) || (cmd === 'git' && /^(diff|show|log|status|blame|ls-files)$/.test(gitParse(w).sub || ''))
      || (cmd === 'node' && rest[0] && /^(--test|--check)$/.test(rest[0]));
    if (!readOnly || /(^|[^<])>/.test(raw)) return 'The production guard and the settings that load it can only be changed by the human.';
  }

  // Secret files (.env, .env.local, .env*) — .env.example is the documented template.
  if (w.some((t) => SECRET_FILE.test(t) && !/\.env\.example$/.test(t))) return 'Reading local .env secret files is not allowed (.env.example is fine).';

  if (cmd === 'git') return gitProblem(w, ctx);
  if (cmd === 'gh') return ghProblem(w);
  if (cmd === 'vercel' || cmd === 'vc') {
    if (rest.some((t) => /^(--prod|--production|--target=production|promote|rollback|redeploy|alias|aliases|env|domains?|dns|certs?|remove|rm|project|projects|link|teams?|secrets?|integration|deploy|git|switch|login|logout|bisect|blob|redirects|rolling-release)$/.test(t))
      || rest.join(' ').includes('--target production')) {
      return 'Vercel CLI production and configuration commands are human-only.';
    }
    return null;
  }
  if (cmd === 'supabase') {
    const t = rest.join(' ');
    if (/(^|\s)(db\s+(push|reset|remote)|migration\s+(up|repair|squash|fetch)|secrets|functions\s+(deploy|delete)|projects\s+(create|delete|api-keys)|branches\s+(create|delete|update|disable)|link|sso|domains|vanity-subdomains|network-restrictions|ssl-enforcement|postgres-config|storage|login|orgs|backups|config\s+push|inspect\s+db)(\s|$)/.test(t)) {
      return 'Supabase CLI commands that change or read the remote project are human-only.';
    }
    return null;
  }
  if (cmd === 'stripe') return 'The Stripe CLI is human-only (the connected Stripe account is live).';
  if (/^(curl|wget|http|https|xh|httpie|aria2c)$/.test(cmd) && PROVIDER_HOSTS.test(rest.join(' '))) {
    return 'Direct HTTP calls to GitHub, Stripe, Vercel, Supabase or Resend APIs are not allowed; use gh api (GitHub) or the read-only connector tools.';
  }
  if (/^(psql|pg_dump|pg_restore|pgcli)$/.test(cmd) && /(supabase\.co|supabase\.com|pooler\.)/i.test(rest.join(' '))) return 'Direct database connections to production are not allowed.';
  if (/^(bash|sh|zsh|dash|ksh|fish|ash)$/.test(cmd)) {
    const ci = rest.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a) || a === '--command');
    if (ci >= 0) return checkBash(rest[ci + 1] || '', ctx);
    if (rest[0] && !rest[0].startsWith('-') && SENSITIVE.test(raw)) return null; // running a script file: checked when it is written
    return null;
  }
  if (cmd === 'eval' || cmd === 'source' || cmd === '.') return checkBash(rest.join(' '), ctx);
  if (/^(python[0-9.]*|node|deno|bun|perl|ruby|php|osascript|lua)$/.test(cmd)) {
    if (rest.some((a) => /^(-[a-zA-Z]*[ce]|--eval|--command|-p|--print)$/.test(a)) && SENSITIVE.test(raw)) {
      return 'Inline interpreter code that runs git, gh or provider CLIs/APIs is not allowed; run the command directly so it can be checked.';
    }
    // Code fed on stdin (heredoc): look at the whole command text for process spawning.
    const stdinScript = !rest.some((a) => !a.startsWith('-')) || rest.includes('-');
    if (stdinScript && SPAWNS.test(ctx.full || raw)) {
      return 'Interpreter code on stdin that starts processes or calls provider APIs is not allowed; run the command directly so it can be checked.';
    }
  }
  if (cmd === 'alias' || cmd === 'function') return SENSITIVE.test(raw) ? 'Shell aliases or functions around git, gh or provider CLIs are not allowed.' : null;
  return null;
}

const SPAWNS = /\b(subprocess|child_process|os\.system|os\.popen|execSync|execFile|spawnSync|spawn\(|Popen|pty\.spawn|urllib\.request|requests\.(post|put|patch|delete)|fetch\(['"]https:\/\/api\.)/;
const SENSITIVE = /\b(gh|git|vercel|supabase|stripe|curl|wget|psql|subprocess|child_process|execSync|spawn|os\.system|requests|urllib|fetch)\b/;

export function checkBash(command, ctx = {}) {
  const context = {
    full: ctx.full ?? String(command || ''),
    currentBranch: ctx.currentBranch ?? null,
    upstream: ctx.upstream ?? null,
    inspect: ctx.inspect || (() => ({})),
    gitAlias: ctx.gitAlias || (() => false),
    depth: (ctx.depth || 0) + 1,
  };
  if (context.depth > 6) return 'Command nesting is too deep to check.';
  const text = String(command || '');
  for (const inner of substitutions(text)) {
    const p = checkBash(inner, context);
    if (p) return p;
  }
  for (const seg of splitCommands(text)) {
    const p = commandProblem(words(seg), context, seg);
    if (p) return p;
  }
  return null;
}

// ------------------------------------------------------------------- SQL

// Production SQL from agents: exactly one call to an allow-listed aggregate
// function with literal arguments, e.g.
//   select public.ops_funnel(now() - interval '7 days', now(), 'source', '')
const SQL_FUNCTIONS = /^(public\.)?(ops_funnel|ops_revenue|ops_health|ops_milestone_metrics|ops_applied_migrations|beta_metrics|account_metrics|upload_metrics|billing_metrics|billing_mode_metrics)$/;
const SQL_LITERAL = /^(?:'(?:[^'\\]|'')*'(?:::[a-z_ ]+(?:\[\])?)?|-?\d+(?:\.\d+)?|true|false|null|now\(\)(?:\s*[-+]\s*interval\s*'[^'\\]*')?|interval\s*'[^'\\]*'|'\{[^'\\]*\}'(?:::[a-z_]+\[\])?)$/i;

function splitArgs(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "'") { if (s[i + 1] === "'") { cur += s[++i]; } else q = false; } continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return q ? null : out;
}

export function checkSql(query) {
  const sql = String(query || '').trim().replace(/;\s*$/, '').trim();
  if (!sql) return 'Empty SQL.';
  if (/--|\/\*|\$\$|\$[A-Za-z_]+\$|"|\bE'/i.test(sql)) return 'Comments, dollar quotes, quoted identifiers and escape strings are not allowed in agent SQL.';
  const m = /^select\s+([A-Za-z_.]+)\s*\(([\s\S]*)\)\s*(?:as\s+[a-z_]+)?$/i.exec(sql);
  if (!m) return 'Agent SQL may only be a single "select <ops_* or *_metrics function>(...)" call; use the aggregate functions, never raw rows.';
  if (!SQL_FUNCTIONS.test(m[1].toLowerCase())) return `SQL function "${m[1]}" is not on the read-only allow-list.`;
  const args = splitArgs(m[2]);
  if (args === null) return 'Unbalanced quotes in SQL.';
  for (const a of args) if (a && !SQL_LITERAL.test(a)) return `SQL argument "${a.slice(0, 60)}" must be a plain literal.`;
  return null;
}

// ------------------------------------------------------------------- MCP

const PRODUCTION_SERVER = /supabase|stripe|vercel|github|resend|postgres|neon/i;
const MCP_READ = /^(list_|get_|search_|read_|query_|fetch_|describe_|retrieve_|inspect_)|^(generate_typescript_types|stripe_api_read|stripe_api_search|stripe_api_details|create_observability_query|web_fetch_vercel_url|search_docs|search_vercel_documentation|search_stripe_documentation)$/;
const MCP_READ_DENY = new Set(['get_project_env', 'get_auth_token', 'get_project_token', 'get_access_to_vercel_url', 'get_bypass_ip',
  'get_shared_env_var', 'get_edge_config_token', 'get_edge_config_tokens', 'get_secret', 'get_secrets', 'get_api_keys', 'get_service_role_key']);

export function checkMcp(toolName, input = {}) {
  const m = /^mcp__(.+?)__([^_].*)$/.exec(String(toolName || ''));
  if (!m) return null;
  const [, server, tool] = m;
  if (!PRODUCTION_SERVER.test(server)) return null;
  if (tool === 'execute_sql') return checkSql(input?.query);
  if (MCP_READ_DENY.has(tool)) return `${server} tool "${tool}" exposes credentials and is human-only.`;
  if (!MCP_READ.test(tool)) return `${server} tool "${tool}" is not a known read-only tool; production tools are read-only for agents.`;
  if (input && (input.decrypt === true || input.decrypt === 'true')) return 'Decrypting environment values is not allowed.';
  if (tool === 'list_projects' || tool.startsWith('list_') || tool.startsWith('get_')) return null;
  return null;
}

// ------------------------------------------------------------ file edits

export function checkEdit(filePath, projectDir = process.cwd()) {
  const abs = path.resolve(projectDir, String(filePath || ''));
  const rel = path.relative(projectDir, abs).split(path.sep).join('/');
  if (/^\.claude\/hooks\//.test(rel) || /^\.claude\/settings(\.local)?\.json$/.test(rel)) {
    return 'The production guard and the settings that load it can only be changed by the human.';
  }
  return null;
}

// ------------------------------------------------------------------ main

export function decide(payload, context = {}) {
  if (!payload || typeof payload !== 'object' || typeof payload.tool_name !== 'string') return 'Guard could not read the tool call.';
  const t = payload.tool_name;
  if (t === 'Bash') return checkBash(payload.tool_input?.command, context);
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return checkEdit(payload.tool_input?.file_path || payload.tool_input?.notebook_path, context.projectDir);
  if (t.startsWith('mcp__')) return checkMcp(t, payload.tool_input);
  return null;
}

function liveContext(cwd) {
  const inspect = (dir) => {
    const at = path.resolve(cwd, dir || '.');
    const branch = git(at, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const upstream = git(at, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return { currentBranch: branch && branch !== 'HEAD' ? branch : null, upstream };
  };
  return {
    ...inspect('.'),
    inspect,
    gitAlias: (name, dir) => Boolean(git(path.resolve(cwd, dir || '.'), ['config', '--get', `alias.${name}`])),
    projectDir: process.env.CLAUDE_PROJECT_DIR || cwd,
  };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  let problem;
  try {
    const cwd = payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    problem = decide(payload, liveContext(cwd));
  } catch {
    problem = 'Guard failed while checking this call.';
  }
  if (problem) {
    process.stderr.write(`Blocked by FYNQ production guard (.claude/hooks/guard.mjs): ${problem}\nThis action is reserved for the human (CLAUDE.md §3). Explain what you need and stop.\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => { process.stderr.write('Blocked: FYNQ production guard crashed; failing closed.\n'); process.exit(2); });
}
