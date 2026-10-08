// Shared Jev (Typesafe) client: a "choice" question over fixed model tiers, used by both the
// interactive picker (pickModel.mjs) and the UserPromptSubmit hook (promptAdvisor.mjs).
//
// Jev is a classifier model, not a conversational LLM - you give it some text and a fixed set
// of labeled options, and it returns one of them with a confidence and a probability per
// option. See https://typesafe.ai (early access / waitlist as of this writing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Generic defaults, meant to be overridden per project - see jev.config.example.json.
// Drop/add tiers freely; whatever keys are here are exactly the options Jev is asked to pick
// from, and exactly what your settings.json's hook has to compare against.
export const DEFAULT_CRITERIA = {
  haiku:
    'A purely mechanical task with one unambiguous correct edit: a single-line tweak, a ' +
    'well-specified one-line fix, a lookup/grep/summary whose answer is trivial to verify. No ' +
    'design judgment, no multi-file reasoning.',
  sonnet:
    'Normal day-to-day software work: a new feature of ordinary scope, a bug fix, dev tooling, ' +
    "refactoring, documentation. The default for anything that isn't clearly at the Haiku or " +
    'Opus extreme.',
  opus:
    'High-stakes or deep-reasoning work: debugging subtle concurrency or algorithmic issues, a ' +
    'single change that touches many files or systems at once, or an irreversible architectural ' +
    'or design judgment call.',
  fable:
    'Long-form creative or narrative writing with little logic: documentation prose, marketing ' +
    'copy, long-form explanations where voice and writing quality matter more than code ' +
    'correctness.',
};

function envFile() {
  return process.env.JEV_ENV_FILE || path.join(process.cwd(), '.env.jev');
}

function criteriaFile() {
  return process.env.JEV_CRITERIA_FILE || path.join(process.cwd(), 'jev.config.json');
}

// User-level fallback so one key serves every project: ~/.claude/.env.jev (same format).
function userEnvFile() {
  return process.env.JEV_USER_ENV_FILE || path.join(os.homedir(), '.claude', '.env.jev');
}

function parseEnvFile(file) {
  const out = {};
  try {
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // Unreadable file: treat as absent.
  }
  return out;
}

// Settings from the environment, then the project's .env.jev, then ~/.claude/.env.jev.
export function config() {
  const project = parseEnvFile(envFile());
  const user = parseEnvFile(userEnvFile());
  const get = (k, d) => process.env[k] || project[k] || user[k] || d;
  return { apiKey: get('TYPESAFE_API_KEY', '') };
}

export const DEFAULT_INSTRUCTIONS = 'Which Claude model tier best fits the task described in state?';

/**
 * Project-specific settings from ./jev.config.json if present, else the generic defaults.
 * Two shapes are accepted: the original flat `{ tier: description, ... }`, or
 * `{ "instructions": "...", "criteria": { tier: description, ... } }` to also tell Jev what kind
 * of codebase this is.
 * @returns {{instructions: string, criteria: Record<string, string>}}
 */
export function loadJevConfig() {
  const file = criteriaFile();
  if (!fs.existsSync(file)) return { instructions: DEFAULT_INSTRUCTIONS, criteria: DEFAULT_CRITERIA };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Couldn't parse ${file} as JSON: ${err.message}`);
  }
  if (parsed && typeof parsed.criteria === 'object' && parsed.criteria) {
    return {
      instructions:
        typeof parsed.instructions === 'string' && parsed.instructions.trim()
          ? parsed.instructions
          : DEFAULT_INSTRUCTIONS,
      criteria: parsed.criteria,
    };
  }
  return { instructions: DEFAULT_INSTRUCTIONS, criteria: parsed };
}

/** Kept for callers that only want the tier descriptions. */
export function loadCriteria() {
  return loadJevConfig().criteria;
}

// Second question, asked in the same request as the tier question (Jev evaluates questions in
// parallel, so it barely adds latency). It flags prompts whose work is mostly many small
// classify / rank / triage judgments, which a Jev tool can do for a fraction of the tokens.
export const BULK_QUESTION = {
  type: 'choice',
  instructions:
    'Does the task described in state mostly consist of making the same simple judgment about ' +
    'many separate items?',
  criteria: {
    bulk:
      'Dozens or more items (log lines, files, issues, test failures, search results, diffs, ' +
      'records) each need a short label, score, ranking or keep/discard decision, e.g. triage ' +
      'every failing test, rank candidate files by relevance, label all open issues.',
    other:
      'Anything else: writing or changing code, explaining, designing, debugging one problem, ' +
      'or a judgment about a single item or a handful of items.',
  },
};

async function callJev(taskText, questions, timeoutMs) {
  const { apiKey } = config();
  if (!apiKey) {
    throw new Error(
      'No TYPESAFE_API_KEY. Set it in the environment or in .env.jev (git-ignored; see .env.jev.example).',
    );
  }
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: taskText, model: 'jev-latest', questions }),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Jev request failed: ${res.status} ${res.statusText}
${await res.text()}`);
  }
  return (await res.json()).answers;
}

function tierQuestion() {
  const { instructions, criteria } = loadJevConfig();
  return { type: 'choice', instructions, criteria };
}

/**
 * One request, two questions: which model tier fits, and (when `bulk` is true) whether the task
 * is bulk classification work. `bulk` in the result is null if Jev didn't return that answer.
 * @returns {Promise<{tier: object, bulk: object|null}>}
 */
export async function askJev(taskText, { timeoutMs, bulk = true } = {}) {
  const questions = { model_tier: tierQuestion() };
  if (bulk) questions.bulk_work = BULK_QUESTION;
  const answers = await callJev(taskText, questions, timeoutMs);
  return { tier: answers.model_tier, bulk: bulk ? (answers.bulk_work ?? null) : null };
}

/** @returns {Promise<{type: string, choice: string, confidence: number, probabilities: Record<string, number>}>} */
export async function pickTier(taskText, { timeoutMs } = {}) {
  return (await askJev(taskText, { timeoutMs, bulk: false })).tier;
}

export function rankedProbabilities(answer) {
  const pct = (p) => `${Math.round(p * 100)}%`;
  return Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(', ');
}
