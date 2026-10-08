// UserPromptSubmit hook: on every prompt, asks Jev which model tier fits it.
//
// - If the session's current model is known (from the transcript or recordModelSwitch.mjs) and
//   Jev confidently says a MORE capable tier is needed, this BLOCKS the prompt with a reason, so
//   it never runs on an under-powered model - resubmit after switching.
// - If the two already agree, it says nothing.
// - Downgrades, unranked tiers (fable), unknown current model, or a mismatch too close to call
//   only add advisory context for Claude to mention if relevant.
// - The same Jev request also asks whether the prompt is bulk classification work; if so (and
//   Jev is confident) a hint is added telling Claude to use a Jev tool if it has one. Turn off
//   with CLAUDE_GUARD_BULK=0. It never blocks, and rides along with or without a tier nudge.
// - Notifications, slash commands, bare "continue" replies are never scored (promptFilter.mjs).
//
// Must never block or slow down a prompt on its own account: any failure (no API key, network
// error, Jev slow, state file unreadable) is swallowed and the hook exits 0 with no output,
// exactly as if it weren't installed. Set CLAUDE_SKIP_MODEL_GUARD=1, or put [[skip-guard]]
// anywhere in the prompt, to bypass for one prompt.
import fs from 'node:fs';
import { askJev, rankedProbabilities } from './jev.mjs';
import { recordScored, resolveCurrent } from './modelState.mjs';
import { classifyPrompt } from './promptFilter.mjs';
import { decide, shouldNudge, shouldHintBulk, bulkHintText } from './decision.mjs';
import { logDecision } from './decisionLog.mjs';

const TIMEOUT_MS = 2500;
// Typed into the prompt itself to skip the guard for just that one prompt - stays in the
// transcript (hooks can't rewrite the prompt text), but that's a small price for not needing
// a separate terminal/env var mid-flow.
const SKIP_PHRASE = /\[\[skip-guard\]\]/i;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// .env.jev and jev.config.json are looked up relative to the working directory, so point it at
// the project even when this script is installed once, globally, outside the project.
function enterProjectDir(input) {
  const dir = process.env.CLAUDE_PROJECT_DIR || input?.cwd;
  try {
    if (dir && fs.existsSync(dir)) process.chdir(dir);
  } catch {
    // Stay where we are.
  }
  return dir;
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return; // Not valid JSON input - say nothing, let the prompt through untouched.
  }

  const raw = input?.prompt;
  if (!raw || !raw.trim()) return;
  if (process.env.CLAUDE_SKIP_MODEL_GUARD || SKIP_PHRASE.test(raw)) return;
  const projectDir = enterProjectDir(input);
  const log = (record) => logDecision(projectDir, { session: input.session_id, prompt: raw, ...record });

  const filtered = classifyPrompt(raw);
  if (filtered.skip) return log({ action: 'skip', reason: filtered.reason });

  const current = resolveCurrent(input);
  // A short follow-up ("fix that too") says nothing about difficulty on its own, so score it
  // together with what Claude just said - or skip it if there's nothing to go on.
  let state = filtered.text;
  if (filtered.needsContext) {
    if (!current.lastText) return log({ action: 'skip', reason: 'short-no-context' });
    state = `Previous assistant message (excerpt):\n${current.lastText}\n\nUser's reply:\n${filtered.text}`;
  }

  const { tier: answer, bulk } = await askJev(state, {
    timeoutMs: TIMEOUT_MS,
    bulk: process.env.CLAUDE_GUARD_BULK !== '0',
  });
  const hintBulk = shouldHintBulk(bulk);
  const pct = Math.round(answer.confidence * 100);
  const ranked = rankedProbabilities(answer);

  const opts = { blockDowngrades: process.env.CLAUDE_GUARD_BLOCK_DOWNGRADES === '1' };
  const verdict = decide({
    currentTier: current.tier,
    choice: answer.choice,
    confidence: answer.confidence,
    promptsSinceSwitch: current.promptsSinceSwitch,
    history: current.history,
  }, opts);

  // A nudge that is low-confidence or too soon after the last one is dropped, not sent.
  const suppressed =
    verdict.action === 'nudge' &&
    !shouldNudge({ confidence: answer.confidence, history: current.history }, opts);
  const action = suppressed ? 'nudge-suppressed' : verdict.action;

  recordScored(input, {
    nudged: action === 'nudge',
    choice: answer.choice,
    confidence: answer.confidence,
  });
  log({
    action,
    reason: verdict.reason,
    kind: verdict.kind,
    choice: answer.choice,
    confidence: Number(answer.confidence.toFixed(3)),
    currentTier: current.tier,
    sinceSwitch: current.promptsSinceSwitch,
    bulk: bulk ? bulk.choice : undefined,
    bulkConfidence: bulk ? Number(bulk.confidence.toFixed(3)) : undefined,
    bulkHint: hintBulk || undefined,
  });

  const emit = (additionalContext) =>
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }),
    );

  if (action === 'none' || action === 'nudge-suppressed') {
    // Match, sticky, or throttled: no tier message, but a bulk hint is independent of that.
    if (hintBulk) emit(bulkHintText(bulk));
    return;
  }

  if (verdict.action === 'block') {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          `Jev suggests this prompt needs ${answer.choice} (confidence ${pct}%; ${ranked}), but ` +
          `the session is running ${current.tier}. Switch models (the panel dropdown, or ` +
          `/model ${answer.choice}) and resubmit, or set CLAUDE_SKIP_MODEL_GUARD=1 to bypass once.`,
      }),
    );
    return;
  }

  // Current tier unknown, a downgrade, an unranked tier, or a mismatch too uncertain to block
  // on: fall back to the advisory nudge, which leans on Claude's own self-knowledge.
  const context =
    `Jev model-tier suggestion for this prompt: ${answer.choice} (confidence ${pct}%; ${ranked}). ` +
    'If this tier clearly differs from the model you are currently running as, say so to the ' +
    'user in one short line before the rest of your response; otherwise say nothing about it.';
  emit(hintBulk ? `${context}\n\n${bulkHintText(bulk)}` : context);
}

main().catch(() => {}); // Jev unavailable/unconfigured/timed out: fail silent, never block.
