#!/usr/bin/env node
// FYNQ production guard: a Claude Code PreToolUse hook.
//
// Hooks run in every permission mode, including auto-approve and
// bypassPermissions, so this is the hard backstop behind CLAUDE.md §3 and the
// prefix rules in .claude/settings.json (which can be bypassed and stop
// applying in auto-approve mode). It blocks a tool call by exiting with code 2
// and a reason on stderr.
//
// Blocks:
//   * pushes to, deletes of, or force pushes to the protected branches
//   * merging PRs (gh pr merge, gh api .../merge, .../merges, auto-merge)
//   * GitHub writes other than issues, comments, labels, reviews and opening
//     or editing PRs (branch protection, repo settings, secrets, workflows)
//   * Vercel CLI production and configuration commands
//   * Supabase CLI commands that change the remote project
//   * the Stripe CLI, and direct HTTP calls to Stripe, Vercel or Supabase APIs
//   * reading local secret files (.env, .env.local, ...; .env.example is fine)
//   * MCP tools that write to Supabase, Stripe or Vercel
//   * Supabase SQL that is not a read-only SELECT of allow-listed functions
//
// Fails closed: if the input can't be parsed, the call is blocked.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROTECTED_BRANCHES = ['main', 'feat/connect-ask-backend'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const PROTECTED = PROTECTED_BRANCHES.map(esc).join('|');

// --------------------------------------------------------------- Bash

/** Splits a command line into simple commands on ; && || | and newlines. */
export function segments(command) {
  return String(command)
    .replace(/\\\n/g, ' ')
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** Strips leading env assignments and wrappers (sudo, npx, env, time, ...). */
function core(segment) {
  let s = segment.replace(/^\(+/, '').trim();
  for (;;) {
    const next = s
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(sudo|env|time|nohup|exec|command|builtin)\s+/, '')
      .replace(/^(npx|pnpm\s+dlx|pnpm\s+exec|bunx|yarn\s+dlx|npm\s+exec)\s+(--?\S+\s+)*/, '');
    if (next === s) return s;
    s = next;
  }
}

function gitPushProblem(cmd, currentBranch) {
  const args = cmd.split(' ').slice(2); // after "git push"
  if (args.some((a) => a === '--mirror')) return 'git push --mirror is not allowed.';
  if (args.some((a) => a === '--all')) return 'git push --all is not allowed.';
  const positional = args.filter((a) => !a.startsWith('-'));
  const refspecs = positional.slice(1); // first positional is the remote
  const deleting = args.some((a) => a === '-d' || a === '--delete');
  for (const spec of refspecs) {
    const dest = spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec;
    const clean = dest.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if (PROTECTED_BRANCHES.includes(clean)) return `Pushing to or deleting the protected branch "${clean}" is not allowed.`;
    if (deleting && PROTECTED_BRANCHES.includes(spec.replace(/^refs\/heads\//, ''))) return `Deleting "${spec}" is not allowed.`;
  }
  if (!refspecs.length && currentBranch && PROTECTED_BRANCHES.includes(currentBranch)) {
    return `You are on the protected branch "${currentBranch}"; a bare git push would push to it.`;
  }
  return null;
}

// GitHub API writes that are allowed: issues, comments, labels, reviews,
// opening a PR and editing a PR's title/body. Everything else is blocked.
const GH_WRITE_ALLOWED = [
  /^\/?repos\/[^/\s]+\/[^/\s]+\/issues(\/\d+(\/(comments|labels(\/[^/\s]+)?))?)?$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/issues\/comments\/\d+$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/labels(\/[^/\s]+)?$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls\/\d+$/,
  /^\/?repos\/[^/\s]+\/[^/\s]+\/pulls\/\d+\/(comments|reviews|requested_reviewers)$/,
];

function ghApiProblem(cmd) {
  const tokens = cmd.split(' ');
  const path = tokens.slice(2).find((t) => !t.startsWith('-') && /repos\/|^\/?graphql|^\/?user|^\/?orgs/.test(t)) || '';
  const cleanPath = path.replace(/^["']|["']$/g, '').split('?')[0];
  if (/\/merges?(\/|$)|auto_merge|\/protection|\/rulesets|\/actions\/(secrets|variables|workflows\/[^/]+\/(enable|disable))|\/environments|\/collaborators|\/hooks|\/keys|\/branches\/[^/]+\/rename/.test(cleanPath)) {
    return `GitHub API path "${cleanPath}" is human-only (merges, branch protection, secrets, workflows, settings).`;
  }
  if (/^\/?graphql/.test(cleanPath) && /mutation/i.test(cmd)) return 'GitHub GraphQL mutations are not allowed.';
  const methodFlag = /(?:^|\s)(?:-X|--method)\s*=?\s*([A-Za-z]+)/.exec(cmd);
  const hasBody = /(?:^|\s)(-f|-F|--field|--raw-field|--input)(\s|=)/.test(cmd);
  const method = methodFlag ? methodFlag[1].toUpperCase() : hasBody ? 'POST' : 'GET';
  if (method === 'GET' || method === 'HEAD') return null;
  if (GH_WRITE_ALLOWED.some((re) => re.test(cleanPath))) {
    if (/\/pulls\/\d+$/.test(cleanPath) && /(^|\s)(-f|-F|--field|--raw-field)\s*base=/.test(cmd)) return 'Changing a PR base branch is human-only.';
    if (method === 'DELETE' && !/labels\//.test(cleanPath)) return 'Deleting GitHub resources is not allowed.';
    return null;
  }
  return `GitHub API ${method} ${cleanPath || '(unknown path)'} is not on the allow-list (issues, comments, labels, reviews, opening/editing PRs).`;
}

export function checkBash(command, { currentBranch = null } = {}) {
  const text = String(command || '');
  for (const seg of segments(text)) {
    const cmd = core(seg);

    if (/^git\s+push(\s|$)/.test(cmd)) {
      const p = gitPushProblem(cmd, currentBranch);
      if (p) return p;
    }
    if (/^git\s+(remote\s+(set-url|add|remove)|config\s+.*(url\.|remote\.))/.test(cmd) && /push|insteadof/i.test(cmd)) {
      return 'Rewriting git remotes or push URLs is not allowed.';
    }
    if (/^gh\s+pr\s+merge(\s|$)/.test(cmd)) return 'Merging PRs is human-only.';
    if (/^gh\s+pr\s+(edit\s+.*--base|ready\s+.*--undo)/.test(cmd)) return 'Changing a PR base branch is human-only.';
    if (/^gh\s+(repo\s+(edit|delete|rename|archive|unarchive|deploy-key|sync)|secret|variable|ruleset|workflow\s+(enable|disable)|release\s+(create|delete|edit)|auth\s+(token|refresh|login|logout))(\s|$)/.test(cmd)) {
      return `"${cmd.split(' ').slice(0, 3).join(' ')}" is human-only.`;
    }
    if (/^gh\s+api(\s|$)/.test(cmd)) {
      const p = ghApiProblem(cmd);
      if (p) return p;
    }

    if (/^vercel(\s|$)/.test(cmd)) {
      if (/(^|\s)(--prod|--production|--target[ =]production|promote|rollback|redeploy|alias|env|domains?|dns|certs?|remove|rm|project|link|teams?|secrets?|integration|deploy)(\s|$)/.test(cmd)) {
        return 'Vercel CLI production/configuration commands are human-only. Read deployments with the read-only tools instead.';
      }
    }
    if (/^supabase(\s|$)/.test(cmd) && /(^|\s)(db\s+(push|reset|remote)|migration\s+(up|repair|squash)|secrets|functions\s+(deploy|delete)|projects\s+(create|delete)|branches\s+(create|delete|update|disable)|link|sso|domains|vanity-subdomains|network-restrictions|ssl-enforcement|postgres-config|storage\s+(rm|mv|cp))(\s|$)/.test(cmd)) {
      return 'Supabase CLI commands that change the remote project are human-only.';
    }
    if (/^stripe(\s|$)/.test(cmd)) return 'The Stripe CLI is human-only (the connected Stripe account is live).';
    if (/^(curl|wget|http|https|xh)\s/.test(cmd) && /(api\.stripe\.com|api\.vercel\.com|supabase\.co|supabase\.com\/v1|api\.supabase\.com|pooler\.supabase\.com)/i.test(cmd)) {
      return 'Direct HTTP calls to Stripe, Vercel or Supabase APIs are not allowed; use the read-only connector tools.';
    }
    if (/^(psql|pg_dump|pg_restore)\s/.test(cmd) && /(supabase\.co|supabase\.com|pooler\.)/i.test(cmd)) {
      return 'Direct database connections to production are not allowed.';
    }
    // Local secret files. .env.example is the documented, secret-free template.
    if (/(^|[\s'"=<>/])\.env(\.[A-Za-z0-9_-]+)*(?=[\s'"]|$)/.test(cmd)) {
      const mentions = cmd.match(/(?:^|[\s'"=<>/])(\.env(?:\.[A-Za-z0-9_-]+)*)(?=[\s'"]|$)/g) || [];
      if (mentions.some((m) => !/\.env\.example$/.test(m.trim().replace(/^['"=<>/]/, '')))) {
        if (!/^(git\s+(status|diff\s+--stat|check-ignore|ls-files)|ls|grep\s+-[lc])/.test(cmd)) return 'Reading local .env secret files is not allowed (.env.example is fine).';
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- MCP

const MCP_WRITE_TOOLS = new Set([
  // Supabase
  'apply_migration', 'deploy_edge_function', 'merge_branch', 'rebase_branch', 'pause_project', 'restore_project',
  'create_project', 'update_storage_config',
  // Stripe
  'stripe_api_write', 'manage_stripe_accounts', 'create_refund', 'create_price', 'create_product', 'create_customer',
  'update_subscription', 'cancel_subscription', 'create_payment_link', 'create_invoice', 'finalize_invoice',
  // Vercel
  'create_deployment', 'cancel_deployment', 'request_promote', 'request_rollback', 'assign_alias',
  'start_rolling_release', 'approve_rolling_release_stage', 'complete_rolling_release', 'update_rolling_release_config',
  'create_project_env', 'edit_project_env', 'get_project_env', 'update_shared_env_variable', 'update_project',
  'pause_project', 'unpause_project', 'add_project_domain', 'create_or_transfer_domain', 'buy_domain', 'buy_domains',
  'buy_single_domain', 'update_record', 'replace_domain_dns_records', 'add_route', 'edit_route', 'stage_routes',
  'update_route_versions', 'stage_redirects', 'update_bulk_redirect_version', 'update_project_protection_bypass',
  'patch_url_protection_bypass', 'put_firewall_config', 'update_firewall_config', 'update_attack_challenge_mode',
  'update_edge_config', 'patch_edge_config_items', 'patch_edge_config_schema', 'restore_edge_config_backup',
  'create_edge_config_token', 'update_flag', 'create_flag', 'update_flag_settings', 'update_flag_segment',
  'create_drain', 'update_drain', 'update_network', 'create_api_keys', 'get_auth_token', 'get_project_token',
  'create_project', 'create_git_project', 'issue_cert', 'invalidate_by_tags', 'invalidate_by_src_images',
  'update_connector', 'upsert_connector_project_connection', 'replace_connector_trigger_destinations',
  'accept_project_transfer_request', 'join_team', 'create_kms_signing_key', 'activate_kms_signing_key',
  'revoke_kms_signing_key', 'sign_kms_message', 'sign_kms_token', 'create_kms_issuer_policy', 'update_kms_issuer',
  'update_kms_issuer_policy', 'update_check', 'update_project_check', 'create_check', 'rerequest_check',
  'update_private_link_endpoint', 'create_private_link_endpoint', 'get_bypass_ip', 'update_sandbox',
  'get_shared_env_var', 'filter_project_envs_decrypted', 'upload_file', 'upload_artifact', 'record_events',
  'get_access_to_vercel_url', 'import-claude-design-from-url',
]);
// Named like writes but read-only.
const MCP_READ_EXCEPTIONS = new Set(['create_observability_query']);
const PRODUCTION_SERVERS = /^(supabase|stripe|vercel)$/i;

// Functions a read-only agent query may call. Anything else (including every
// SECURITY DEFINER write function in public) is refused.
const SQL_FUNCTIONS_ALLOWED = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest', 'least', 'round', 'floor', 'ceil', 'abs',
  'date_trunc', 'date_part', 'extract', 'to_char', 'to_timestamp', 'now', 'age', 'interval', 'lower', 'upper',
  'length', 'char_length', 'left', 'right', 'substr', 'substring', 'trim', 'btrim', 'concat', 'format', 'percentile_cont',
  'percentile_disc', 'string_agg', 'array_agg', 'array_length', 'unnest', 'jsonb_agg', 'jsonb_build_object',
  'jsonb_object_agg', 'jsonb_array_length', 'jsonb_typeof', 'json_agg', 'json_build_object', 'row_number', 'rank',
  'dense_rank', 'lag', 'lead', 'generate_series', 'current_date', 'current_timestamp', 'version', 'pg_size_pretty',
  'pg_total_relation_size', 'pg_relation_size', 'pg_get_functiondef', 'pg_get_viewdef', 'has_table_privilege',
  'has_function_privilege', 'obj_description', 'col_description', 'format_type', 'to_regclass', 'cast', 'bool_and',
  'bool_or', 'every', 'filter', 'exists', 'any', 'all', 'in', 'values', 'over', 'as', 'and', 'or', 'not', 'on', 'from',
  'where', 'select', 'when', 'then', 'else', 'case', 'is', 'like', 'ilike', 'between', 'distinct', 'within', 'group',
  'partition', 'using', 'join', 'lateral', 'with', 'by', 'having', 'union', 'intersect', 'except', 'limit', 'offset',
]);
const SQL_ALLOWED_PUBLIC = /^public\.(ops_[a-z_]+|beta_metrics|account_metrics|upload_metrics|billing_metrics|billing_mode_metrics)$/;
const SQL_ALLOWED_BARE = /^(ops_[a-z_]+|beta_metrics|account_metrics|upload_metrics|billing_metrics|billing_mode_metrics)$/;

export function checkSql(query) {
  const raw = String(query || '');
  // Drop comments and string literals before looking at keywords.
  const sql = raw
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .trim()
    .replace(/;\s*$/, '');
  if (!sql) return 'Empty SQL.';
  if (sql.includes(';')) return 'Only a single SQL statement is allowed.';
  if (!/^(select|with|explain(?!\s+analyze))\b/i.test(sql)) return 'Only read-only SELECT queries are allowed against production.';
  if (/\b(insert|update|delete|merge|upsert|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|cluster|reindex|comment|security|set|reset|lock|refresh|listen|notify|prepare|execute|discard|import|load|into)\b/i.test(sql)) {
    return 'This SQL contains a write or session-changing keyword; production is read-only.';
  }
  for (const m of sql.matchAll(/([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(/g)) {
    const name = m[1].toLowerCase();
    if (SQL_FUNCTIONS_ALLOWED.has(name) || SQL_ALLOWED_PUBLIC.test(name) || SQL_ALLOWED_BARE.test(name)) continue;
    if (/^(pg_catalog|information_schema)\./.test(name)) continue;
    return `SQL function "${m[1]}" is not on the read-only allow-list (use the ops_* / *_metrics aggregate functions).`;
  }
  return null;
}

export function checkMcp(toolName, input = {}) {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(toolName || ''));
  if (!m) return null;
  const [, server, tool] = m;
  if (!PRODUCTION_SERVERS.test(server)) return null;
  if (MCP_READ_EXCEPTIONS.has(tool)) return null;
  if (MCP_WRITE_TOOLS.has(tool)) return `${server} tool "${tool}" changes production and is human-only.`;
  if (/^(create|update|delete|edit|put|patch|add|remove|set|buy|assign|request|approve|complete|start|cancel|pause|unpause|restore|revoke|activate|sign|invalidate|replace|upsert|accept|join|rerequest|stage|upload|write)_/.test(tool)) {
    return `${server} tool "${tool}" looks like a write; production tools are read-only for agents.`;
  }
  if (/^execute_sql$/.test(tool)) return checkSql(input?.query);
  if (/decrypt/i.test(JSON.stringify(input || {})) && /true/i.test(String(input?.decrypt))) return 'Decrypting environment values is not allowed.';
  return null;
}

// --------------------------------------------------------------- main

export function decide(payload, context = {}) {
  if (!payload || typeof payload !== 'object' || typeof payload.tool_name !== 'string') return 'Guard could not read the tool call.';
  if (payload.tool_name === 'Bash') return checkBash(payload.tool_input?.command, context);
  if (payload.tool_name.startsWith('mcp__')) return checkMcp(payload.tool_name, payload.tool_input);
  return null;
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const branch = payload?.tool_name === 'Bash' ? currentBranch(payload?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()) : null;
  let problem;
  try { problem = decide(payload, { currentBranch: branch }); } catch { problem = 'Guard failed while checking this call.'; }
  if (problem) {
    process.stderr.write(`Blocked by FYNQ production guard (.claude/hooks/guard.mjs): ${problem}\nThis action is reserved for the human (CLAUDE.md §3). Explain what you need and stop.\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { process.stderr.write('Blocked: FYNQ production guard crashed; failing closed.\n'); process.exit(2); });
}
