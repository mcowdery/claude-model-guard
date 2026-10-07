// Registers (or removes) the model-guard hooks in a Claude Code settings file, pointing at THIS
// checkout, so one copy of the scripts serves every project and a `git pull` updates them all.
//
//   node scripts/install.mjs --global                 # ~/.claude/settings.json
//   node scripts/install.mjs --project <dir>          # <dir>/.claude/settings.local.json
//   node scripts/install.mjs --project <dir> --shared # <dir>/.claude/settings.json
//   add --uninstall to remove, --dry-run to print the result without writing.
//
// Idempotent: existing model-guard entries (from any path) are replaced, other hooks are kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const HOOKS = {
  UserPromptSubmit: 'promptAdvisor.mjs',
  PostModelSwitch: 'recordModelSwitch.mjs',
  SessionStart: 'recordModelSwitch.mjs',
};
const OURS = new Set(Object.values(HOOKS));

const isOurs = (entry) =>
  entry?.hooks?.some((h) => [...OURS].some((f) => String(h.command).includes(f)));

export function applyHooks(settings, { uninstall = false } = {}) {
  const out = { ...settings, hooks: { ...settings.hooks } };
  for (const [event, file] of Object.entries(HOOKS)) {
    const kept = (out.hooks[event] ?? []).filter((e) => !isOurs(e));
    if (!uninstall) {
      kept.push({ hooks: [{ type: 'command', command: `node "${SCRIPTS}/${file}"` }] });
    }
    if (kept.length) out.hooks[event] = kept;
    else delete out.hooks[event];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

function targetFile(args) {
  if (args.includes('--global')) return path.join(os.homedir(), '.claude', 'settings.json');
  const i = args.indexOf('--project');
  if (i === -1 || !args[i + 1]) return null;
  const name = args.includes('--shared') ? 'settings.json' : 'settings.local.json';
  return path.join(path.resolve(args[i + 1]), '.claude', name);
}

function main(args) {
  const file = targetFile(args);
  if (!file) {
    console.error('Usage: install.mjs (--global | --project <dir> [--shared]) [--uninstall] [--dry-run]');
    process.exit(1);
  }
  let settings = {};
  if (fs.existsSync(file)) settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = JSON.stringify(applyHooks(settings, { uninstall: args.includes('--uninstall') }), null, 2);
  if (args.includes('--dry-run')) {
    console.log(`# ${file}\n${next}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next + '\n');
  console.log(`${args.includes('--uninstall') ? 'Removed hooks from' : 'Installed hooks in'} ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
