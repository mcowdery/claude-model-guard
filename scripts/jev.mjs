// Shared Jev (Typesafe) client: a "choice" question over fixed model tiers, used by both the
// interactive picker (pickModel.mjs) and the UserPromptSubmit hook (promptAdvisor.mjs).
//
// Jev is a classifier model, not a conversational LLM - you give it some text and a fixed set
// of labeled options, and it returns one of them with a confidence and a probability per
// option. See https://typesafe.ai (early access / waitlist as of this writing).
import fs from 'node:fs';
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

// Settings from the environment, then .env.jev (KEY=value lines, git-ignored), then defaults.
export function config() {
  const file = envFile();
  const fromFile = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trimStart().startsWith('#')) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const get = (k, d) => process.env[k] ?? fromFile[k] ?? d;
  return { apiKey: get('TYPESAFE_API_KEY', '') };
}

/** Project-specific criteria from ./jev.config.json if present, else the generic defaults. */
export function loadCriteria() {
  const file = criteriaFile();
  if (!fs.existsSync(file)) return DEFAULT_CRITERIA;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Couldn't parse ${file} as JSON: ${err.message}`);
  }
}

/** @returns {Promise<{type: string, choice: string, confidence: number, probabilities: Record<string, number>}>} */
export async function pickTier(taskText, { timeoutMs } = {}) {
  const { apiKey } = config();
  if (!apiKey) {
    throw new Error(
      'No TYPESAFE_API_KEY. Set it in the environment or in .env.jev (git-ignored; see .env.jev.example).',
    );
  }
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: taskText,
      model: 'jev-latest',
      questions: {
        model_tier: {
          type: 'choice',
          instructions: 'Which Claude model tier best fits the task described in state?',
          criteria: loadCriteria(),
        },
      },
    }),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Jev request failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  const body = await res.json();
  return body.answers.model_tier;
}

export function rankedProbabilities(answer) {
  const pct = (p) => `${Math.round(p * 100)}%`;
  return Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(', ');
}
