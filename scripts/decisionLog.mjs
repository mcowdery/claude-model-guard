// Appends one JSON line per hook decision, so BLOCK_CONFIDENCE and the criteria can be tuned
// from real data. Best-effort: never throws. Disable with CLAUDE_GUARD_LOG=0.
import fs from 'node:fs';
import path from 'node:path';

const PROMPT_CHARS = 120;

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
    fs.appendFileSync(path.join(dir, 'model-guard.log.jsonl'), line + '\n');
  } catch {
    // Logging must never affect the prompt.
  }
}
