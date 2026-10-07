// Tracks which model tier the current Claude Code session is actually running. Written by
// recordModelSwitch.mjs (the PostModelSwitch / SessionStart hooks) and read by
// promptAdvisor.mjs (UserPromptSubmit) to tell a real tier mismatch from a guess.
import fs from 'node:fs';
import path from 'node:path';

function statePath(input) {
  const dir = input?.scratchpad_dir;
  return dir ? path.join(dir, 'model-state.json') : null;
}

// Canonical model ids look like "claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5",
// "claude-fable-5-1" - match on the family name, not the version, so this doesn't need
// updating when a new point release ships. Add more tiers here if your jev.config.json does.
export function tierOf(modelId) {
  if (!modelId) return null;
  const m = modelId.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  return null;
}

export function readCurrentTier(input) {
  const file = statePath(input);
  if (!file) return null;
  try {
    const { modelId } = JSON.parse(fs.readFileSync(file, 'utf8'));
    return tierOf(modelId);
  } catch {
    return null;
  }
}

export function writeCurrentModel(input, modelId) {
  const file = statePath(input);
  if (!file || !modelId) return;
  try {
    fs.writeFileSync(file, JSON.stringify({ modelId, at: Date.now() }));
  } catch {
    // Best-effort only - a failed write just means the next prompt falls back to advisory mode.
  }
}
