// Appends one JSON line per hook decision, so BLOCK_CONFIDENCE and the criteria can be tuned
// from real data. Best-effort: never throws. Disable with CLAUDE_GUARD_LOG=0.
import fs from 'node:fs';
import path from 'node:path';

const PROMPT_CHARS = 120;
export const MAX_LOG_BYTES = 1024 * 1024;

// Keep one previous generation (.1) so the log never grows past about 2x MAX_LOG_BYTES.
export function rotateIfLarge(file, max = MAX_LOG_BYTES) {
  try {
    if (fs.statSync(file).size < max) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or rotation failed: just keep appending.
  }
}

export function logDecision(projectDir, record) {
  if (process.env.CLAUDE_GUARD_LOG === '0' || !projectDir) return;
  try {
    const dir = path.join(projectDir, '.claude');
    if (!fs.existsSync(dir)) return; // not a Claude Code project dir; don't create stray folders
    const line = JSON.stringify({
      at: new Date().toISOString(),
      ...record,
      prompt: record.prompt?.replace(/\s+/g, ' ').slice(0, PROMPT_CHARS),
    });
    const file = path.join(dir, 'model-guard.log.jsonl');
    rotateIfLarge(file);
    fs.appendFileSync(file, line + '\n');
  } catch {
    // Logging must never affect the prompt.
  }
}
