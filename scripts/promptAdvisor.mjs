// UserPromptSubmit hook: on every prompt, asks Jev which model tier fits it.
//
// - If the session's current model is known (recordModelSwitch.mjs has seen a PostModelSwitch
//   or SessionStart) and it confidently disagrees with Jev's pick, this BLOCKS the prompt with
//   a reason, so it never runs on the wrong model - resubmit after switching.
// - If the two already agree, it says nothing.
// - If the current model isn't known yet (fresh session, no switch seen), or the mismatch is
//   too close to call, it only adds advisory context for Claude to mention if relevant.
//
// Must never block or slow down a prompt on its own account: any failure (no API key, network
// error, Jev slow, state file unreadable) is swallowed and the hook exits 0 with no output,
// exactly as if it weren't installed. Set CLAUDE_SKIP_MODEL_GUARD=1, or put [[skip-guard]]
// anywhere in the prompt, to bypass for one prompt.
import { pickTier, rankedProbabilities } from './jev.mjs';
import { readCurrentTier } from './modelState.mjs';

const TIMEOUT_MS = 2500;
// Only hard-block when Jev is this confident; a near-coin-flip mismatch just gets a soft nudge.
const BLOCK_CONFIDENCE = 0.65;
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

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return; // Not valid JSON input - say nothing, let the prompt through untouched.
  }

  const prompt = input?.prompt;
  if (!prompt || !prompt.trim()) return;
  if (process.env.CLAUDE_SKIP_MODEL_GUARD || SKIP_PHRASE.test(prompt)) return;

  const answer = await pickTier(prompt, { timeoutMs: TIMEOUT_MS });
  const currentTier = readCurrentTier(input);
  const pct = Math.round(answer.confidence * 100);
  const ranked = rankedProbabilities(answer);

  if (currentTier && currentTier === answer.choice) {
    return; // Confirmed match - stay quiet, no need to say so every time.
  }

  if (currentTier && answer.confidence >= BLOCK_CONFIDENCE) {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          `Jev suggests this prompt fits ${answer.choice} (confidence ${pct}%; ${ranked}), but ` +
          `the session is running ${currentTier}. Switch models (the panel dropdown, or ` +
          `/model ${answer.choice}) and resubmit, or set CLAUDE_SKIP_MODEL_GUARD=1 to bypass once.`,
      }),
    );
    return;
  }

  // Current tier unknown (no switch seen yet this session), or a mismatch too uncertain to
  // block on: fall back to the advisory nudge, which leans on Claude's own self-knowledge.
  const context =
    `Jev model-tier suggestion for this prompt: ${answer.choice} (confidence ${pct}%; ${ranked}). ` +
    'If this tier clearly differs from the model you are currently running as, say so to the ' +
    'user in one short line before the rest of your response; otherwise say nothing about it.';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }),
  );
}

main().catch(() => {}); // Jev unavailable/unconfigured/timed out: fail silent, never block.
