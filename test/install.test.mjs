import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHooks } from '../scripts/install.mjs';

const other = { hooks: [{ type: 'command', command: 'echo hi' }] };

test('install adds all three hooks and keeps unrelated ones', () => {
  const after = applyHooks({ hooks: { UserPromptSubmit: [other] }, model: 'x' });
  assert.equal(after.model, 'x');
  assert.equal(after.hooks.UserPromptSubmit.length, 2);
  assert.ok(after.hooks.PostModelSwitch && after.hooks.SessionStart);
});
test('install is idempotent and replaces old paths', () => {
  const old = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/old/promptAdvisor.mjs"' }] }] } };
  const once = applyHooks(old);
  assert.deepEqual(once, applyHooks(once));
  assert.equal(once.hooks.UserPromptSubmit.length, 1);
  assert.ok(!JSON.stringify(once).includes('/old/'));
});
test('uninstall removes ours only', () => {
  const s = applyHooks({ hooks: { UserPromptSubmit: [other] } });
  assert.deepEqual(applyHooks(s, { uninstall: true }).hooks, { UserPromptSubmit: [other] });
});
