// Tracks which model tier the current Claude Code session is actually running.
//
// Two sources, newest wins:
//  - a small state file written by recordModelSwitch.mjs (PostModelSwitch / SessionStart hooks)
//  - the session transcript: every assistant message records the model that produced it, so it
//    stays correct even when a switch (e.g. from an IDE's model picker) fired no hook.
// The transcript lags right after a switch (no new assistant message yet), which is why the
// state file still matters.
import fs from 'node:fs';
import path from 'node:path';

const TAIL_BYTES = 512 * 1024;
const CONTEXT_CHARS = 600;

// Ladder used to tell an upgrade from a downgrade. Tiers not listed here (e.g. fable, a writing
// tier rather than a "more capable" one) are never ranked, so they never trigger a hard block.
export const TIER_RANK = { haiku: 0, sonnet: 1, opus: 2 };

function statePath(input) {
  const dir = input?.scratchpad_dir;
  return dir ? path.join(dir, 'model-state.json') : null;
}

// Canonical model ids look like "claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5",
// "claude-fable-5-1" - match on the family name, not the version, so this doesn't need
// updating when a new point release ships. Add more tiers here if your jev.config.json does.
// Placeholders such as "<synthetic>" match nothing and return null.
export function tierOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const m = modelId.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  return null;
}

export function readState(input) {
  const file = statePath(input);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {{fromSwitch?: boolean}} [opts] fromSwitch: a real /model change, not just SessionStart */
export function writeCurrentModel(input, modelId, { fromSwitch = false } = {}) {
  const file = statePath(input);
  if (!file || !modelId) return;
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ modelId, at: Date.now(), fromSwitch, promptsSinceSwitch: 0 }),
    );
  } catch {
    // Best-effort only - a failed write just means the next prompt falls back to the transcript.
  }
}

/** Count a scored prompt against the post-switch grace period. */
export function bumpPromptCount(input) {
  const state = readState(input);
  const file = statePath(input);
  if (!state || !file) return;
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ ...state, promptsSinceSwitch: (state.promptsSinceSwitch ?? 0) + 1 }),
    );
  } catch {
    // Best-effort.
  }
}

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Newest main-thread assistant model and text from the end of the transcript.
 * @returns {{tier: string|null, at: number, lastText: string}}
 */
export function readTranscriptInfo(input) {
  const info = { tier: null, at: 0, lastText: '' };
  const file = input?.transcript_path;
  if (!file) return info;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (size > len) lines.shift(); // first line is probably cut mid-record
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec;
      try {
        rec = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (rec?.type !== 'assistant' || rec.isSidechain) continue;
      if (!info.lastText) {
        const text = textOf(rec.message).trim();
        if (text) info.lastText = text.slice(-CONTEXT_CHARS);
      }
      if (!info.tier) {
        const tier = tierOf(rec.message?.model);
        if (tier) {
          info.tier = tier;
          info.at = Date.parse(rec.timestamp) || 0;
        }
      }
      if (info.tier && info.lastText) break;
    }
  } catch {
    // Unreadable transcript: behave as if there were none.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return info;
}

/**
 * Best guess at the running tier: the newer of the state file and the transcript.
 * @returns {{tier: string|null, lastText: string, promptsSinceSwitch: number|null}}
 *   promptsSinceSwitch is non-null only while the state file's last event was a real switch.
 */
export function resolveCurrent(input) {
  const state = readState(input);
  const stateTier = tierOf(state?.modelId);
  const transcript = readTranscriptInfo(input);

  let tier = null;
  if (stateTier && transcript.tier) tier = transcript.at > (state.at ?? 0) ? transcript.tier : stateTier;
  else tier = stateTier ?? transcript.tier;

  const sinceSwitch = state?.fromSwitch && stateTier === tier ? (state.promptsSinceSwitch ?? 0) : null;
  return { tier, lastText: transcript.lastText, promptsSinceSwitch: sinceSwitch };
}
