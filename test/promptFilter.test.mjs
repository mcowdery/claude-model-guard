import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, clip, stripNoise, MAX_CHARS } from '../scripts/promptFilter.mjs';

const NOTE = '<task-notification>\n<task-id>x</task-id>\n</task-notification>';

test('task notification alone is skipped', () => {
  assert.equal(classifyPrompt(NOTE).skip, true);
});
test('notification plus bare continue is skipped', () => {
  assert.equal(classifyPrompt(`${NOTE}\ncontinue`).reason, 'continuation');
});
test('notification plus real text scores only the real text', () => {
  const r = classifyPrompt(`${NOTE}\nrefactor the auth module to use sessions`);
  assert.equal(r.skip, false);
  assert.equal(r.text, 'refactor the auth module to use sessions');
});
test('continuation variants', () => {
  for (const p of ['continue', 'Continue.', 'go on', 'ok', 'Yes!', 'proceed']) {
    assert.equal(classifyPrompt(p).skip, true, p);
  }
});
test('slash and bang commands are skipped, pasted paths are not', () => {
  assert.equal(classifyPrompt('/model sonnet').reason, 'command');
  assert.equal(classifyPrompt('/clear').reason, 'command');
  assert.equal(classifyPrompt('!ls -la').reason, 'command');
  assert.equal(classifyPrompt('/home/me/app/server.js throws on startup').skip, false);
});
test('short prompts need context, longer ones do not', () => {
  assert.equal(classifyPrompt('fix that too').needsContext, true);
  assert.equal(classifyPrompt('fix the pagination off-by-one bug').needsContext, false);
});
test('empty input is skipped', () => {
  assert.equal(classifyPrompt('   ').skip, true);
  assert.equal(classifyPrompt(undefined).skip, true);
});
test('pasted blobs are shrunk, the ask is kept', () => {
  const blob = 'log line\n'.repeat(2000);
  const out = stripNoise(`why does this fail?\n<pasted_content id="1">${blob}</pasted_content id="1">`);
  assert.ok(out.length < 1000);
  assert.ok(out.startsWith('why does this fail?'));
});
test('clip keeps head and tail within the cap', () => {
  const s = 'a'.repeat(5000) + 'TAIL';
  const c = clip(s);
  assert.ok(c.length <= MAX_CHARS);
  assert.ok(c.endsWith('TAIL'));
  assert.equal(clip('short'), 'short');
});
