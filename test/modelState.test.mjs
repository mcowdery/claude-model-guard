import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrent, tierOf, writeCurrentModel, recordScored } from '../scripts/modelState.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));
const asst = (model, ts, text = 'ok', extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { model, content: [{ type: 'text', text }] }, ...extra });

function transcript(dir, lines) {
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('tierOf handles real ids, bare names and placeholders', () => {
  assert.equal(tierOf('claude-opus-5-5'), 'opus');
  assert.equal(tierOf('sonnet'), 'sonnet');
  assert.equal(tierOf('<synthetic>'), null);
  assert.equal(tierOf(undefined), null);
});

test('transcript supplies the tier and last assistant text, ignoring synthetic and sidechain', () => {
  const dir = tmp();
  const transcript_path = transcript(dir, [
    asst('claude-opus-5-5', '2026-01-01T00:00:00Z', 'first'),
    asst('claude-sonnet-5-5', '2026-01-01T00:02:00Z', 'latest words'),
    asst('<synthetic>', '2026-01-01T00:03:00Z', 'placeholder'),
    asst('claude-haiku-5-5', '2026-01-01T00:04:00Z', 'sub', { isSidechain: true }),
  ]);
  const r = resolveCurrent({ transcript_path });
  assert.equal(r.tier, 'sonnet');
  assert.equal(r.lastText, 'placeholder'); // newest main-thread text, even from a synthetic message
});

test('newer state file beats older transcript, and vice versa', () => {
  const dir = tmp();
  const transcript_path = transcript(dir, [asst('claude-opus-5-5', '2020-01-01T00:00:00Z')]);
  const input = { transcript_path, scratchpad_dir: dir };
  writeCurrentModel(input, 'claude-haiku-5-5', { fromSwitch: true });
  assert.equal(resolveCurrent(input).tier, 'haiku');

  fs.writeFileSync(path.join(dir, 'model-state.json'), JSON.stringify({ modelId: 'claude-haiku-5-5', at: 1 }));
  assert.equal(resolveCurrent(input).tier, 'opus');
});

test('grace counter only exists after a real switch and counts up', () => {
  const dir = tmp();
  const input = { scratchpad_dir: dir };
  writeCurrentModel(input, 'claude-sonnet-5-5', { fromSwitch: false });
  assert.equal(resolveCurrent(input).promptsSinceSwitch, null);
  writeCurrentModel(input, 'claude-sonnet-5-5', { fromSwitch: true });
  assert.equal(resolveCurrent(input).promptsSinceSwitch, 0);
  recordScored(input);
  assert.equal(resolveCurrent(input).promptsSinceSwitch, 1);
});

test('missing or unreadable inputs degrade to nothing', () => {
  assert.equal(resolveCurrent({}).tier, null);
  assert.equal(resolveCurrent({ transcript_path: '/nope/x.jsonl' }).tier, null);
});
