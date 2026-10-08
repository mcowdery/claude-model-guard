import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, shouldNudge } from '../scripts/decision.mjs';
import { recordScored, resolveCurrent, writeCurrentModel } from '../scripts/modelState.mjs';
import { rotateIfLarge } from '../scripts/decisionLog.mjs';
import { loadJevConfig, DEFAULT_CRITERIA, DEFAULT_INSTRUCTIONS } from '../scripts/jev.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));

test('sticky: a recent task judged opus-level swallows a soft downgrade', () => {
  const history = { promptCount: 4, lastChoice: 'opus', lastChoiceAt: 4 };
  const r = decide({ currentTier: 'opus', choice: 'haiku', confidence: 0.7, promptsSinceSwitch: null, history });
  assert.deepEqual([r.action, r.reason], ['none', 'sticky']);
});
test('sticky yields to a confident reversal, an old judgement, or a lower prior', () => {
  const base = { currentTier: 'opus', choice: 'haiku', promptsSinceSwitch: null };
  const recent = { promptCount: 4, lastChoice: 'opus', lastChoiceAt: 4 };
  assert.equal(decide({ ...base, confidence: 0.95, history: recent }).action, 'nudge');
  assert.equal(decide({ ...base, confidence: 0.7, history: { ...recent, lastChoiceAt: 0 } }).action, 'nudge');
  assert.equal(decide({ ...base, confidence: 0.7, history: { ...recent, lastChoice: 'sonnet' } }).action, 'nudge');
});
test('sticky never creates or suppresses a block', () => {
  const history = { promptCount: 2, lastChoice: 'opus', lastChoiceAt: 2 };
  assert.equal(decide({ currentTier: 'haiku', choice: 'sonnet', confidence: 0.9, promptsSinceSwitch: null, history }).action, 'block');
});

test('nudge throttling: confidence floor and spacing', () => {
  assert.equal(shouldNudge({ confidence: 0.7, history: { promptCount: 0, lastNudgeAt: null } }), false);
  assert.equal(shouldNudge({ confidence: 0.85, history: { promptCount: 0, lastNudgeAt: null } }), true);
  assert.equal(shouldNudge({ confidence: 0.85, history: { promptCount: 3, lastNudgeAt: 2 } }), false);
  assert.equal(shouldNudge({ confidence: 0.85, history: { promptCount: 6, lastNudgeAt: 2 } }), true);
});

test('recordScored tracks history and a model switch resets it', () => {
  const dir = tmp();
  const input = { scratchpad_dir: dir };
  recordScored(input, { nudged: true, choice: 'opus', confidence: 0.9 }); // works with no prior state
  recordScored(input, { choice: 'sonnet', confidence: 0.8 });
  let h = resolveCurrent(input).history;
  assert.deepEqual([h.promptCount, h.lastNudgeAt, h.lastChoice, h.lastChoiceAt], [2, 1, 'sonnet', 2]);
  writeCurrentModel(input, 'claude-opus-5-5', { fromSwitch: true });
  h = resolveCurrent(input).history;
  assert.deepEqual([h.promptCount, h.lastNudgeAt, h.lastChoice], [0, null, null]);
});

test('log rotation moves a big log aside once', () => {
  const dir = tmp();
  const f = path.join(dir, 'x.jsonl');
  fs.writeFileSync(f, 'a'.repeat(100));
  rotateIfLarge(f, 1000);
  assert.ok(fs.existsSync(f));
  rotateIfLarge(f, 50);
  assert.ok(!fs.existsSync(f) && fs.existsSync(`${f}.1`));
  rotateIfLarge(f, 50); // missing file: no throw
});

test('jev config: defaults, flat legacy file, and instructions+criteria file', () => {
  const dir = tmp();
  const file = path.join(dir, 'jev.config.json');
  process.env.JEV_CRITERIA_FILE = file;
  try {
    assert.deepEqual(loadJevConfig(), { instructions: DEFAULT_INSTRUCTIONS, criteria: DEFAULT_CRITERIA });
    fs.writeFileSync(file, JSON.stringify({ haiku: 'h', opus: 'o' }));
    assert.deepEqual(loadJevConfig(), { instructions: DEFAULT_INSTRUCTIONS, criteria: { haiku: 'h', opus: 'o' } });
    fs.writeFileSync(file, JSON.stringify({ instructions: 'for a game', criteria: { haiku: 'h' } }));
    assert.deepEqual(loadJevConfig(), { instructions: 'for a game', criteria: { haiku: 'h' } });
    fs.writeFileSync(file, JSON.stringify({ criteria: { haiku: 'h' } }));
    assert.equal(loadJevConfig().instructions, DEFAULT_INSTRUCTIONS);
  } finally {
    delete process.env.JEV_CRITERIA_FILE;
  }
});
