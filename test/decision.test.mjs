import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/decision.mjs';

const d = (currentTier, choice, confidence, promptsSinceSwitch = null, opts) =>
  decide({ currentTier, choice, confidence, promptsSinceSwitch }, opts);

test('match is silent', () => assert.equal(d('sonnet', 'sonnet', 0.99).action, 'none'));
test('confident upgrade blocks', () => assert.equal(d('haiku', 'sonnet', 0.9).action, 'block'));
test('unconfident upgrade only nudges', () => assert.equal(d('haiku', 'sonnet', 0.5).action, 'nudge'));
test('confident downgrade nudges, not blocks', () => {
  const r = d('sonnet', 'haiku', 0.95);
  assert.deepEqual([r.action, r.kind], ['nudge', 'downgrade']);
});
test('downgrade blocks when opted in', () =>
  assert.equal(d('sonnet', 'haiku', 0.95, null, { blockDowngrades: true }).action, 'block'));
test('unranked tier (fable) never blocks', () => {
  assert.equal(d('sonnet', 'fable', 0.99).action, 'nudge');
  assert.equal(d('fable', 'opus', 0.99).action, 'nudge');
});
test('unknown current tier nudges', () => assert.equal(d(null, 'opus', 0.99).action, 'nudge'));
test('grace period raises the bar', () => {
  assert.equal(d('haiku', 'sonnet', 0.8, 1).action, 'nudge');
  assert.equal(d('haiku', 'sonnet', 0.95, 1).action, 'block');
  assert.equal(d('haiku', 'sonnet', 0.8, 3).action, 'block'); // grace over
});
