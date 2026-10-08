// Runs the real hook as a child process, the way Claude Code does: JSON on stdin, decision on
// stdout, with Jev replaced by test/helpers/stubFetch.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', 'scripts', 'promptAdvisor.mjs');
const STUB = pathToFileURL(path.join(HERE, 'helpers', 'stubFetch.mjs')).href;

function session(currentModel = 'claude-haiku-5-5') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-e2e-'));
  const project = path.join(root, 'project');
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.mkdirSync(scratch);
  const transcript = path.join(root, 't.jsonl');
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { model: currentModel, content: [{ type: 'text', text: 'I can rework the auth layer. Want me to?' }] },
    }) + '\n',
  );
  const out = path.join(root, 'jev-request.json');

  function submit(prompt, choice, conf = 0.9, env = {}) {
    const input = { prompt, cwd: project, scratchpad_dir: scratch, transcript_path: transcript };
    const r = spawnSync(process.execPath, ['--import', STUB, HOOK], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: project,
        TYPESAFE_API_KEY: 'test',
        STUB_CHOICE: choice,
        STUB_CONF: String(conf),
        STUB_OUT: out,
        ...env,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout) : null;
  }
  const log = () => {
    const f = path.join(project, '.claude', 'model-guard.log.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  const jevRequest = () => JSON.parse(fs.readFileSync(out, 'utf8'));
  const jevCalled = () => fs.existsSync(out);
  return { project, submit, log, jevRequest, jevCalled };
}

test('confident upgrade is blocked', () => {
  const s = session('claude-haiku-5-5');
  const r = s.submit('refactor the auth module across all services', 'opus');
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /needs opus/);
  assert.equal(s.log().at(-1).action, 'block');
});

test('matching tier is silent', () => {
  const s = session('claude-opus-5-5');
  assert.equal(s.submit('refactor the auth module across all services', 'opus'), null);
});

test('notifications, commands and bare continue never reach Jev', () => {
  const s = session('claude-haiku-5-5');
  const note = '<task-notification><task-id>x</task-id></task-notification>';
  assert.equal(s.submit(`${note}\ncontinue`, 'opus'), null);
  assert.equal(s.submit('/model opus', 'opus'), null);
  assert.equal(s.submit('continue', 'opus'), null);
  assert.ok(s.log().every((e) => e.action === 'skip'));
  assert.equal(s.jevCalled(), false);
});

test('a short reply is scored together with the previous assistant message', () => {
  const s = session('claude-haiku-5-5');
  const r = s.submit('yes do that please', 'opus');
  assert.equal(r.decision, 'block');
  assert.match(s.jevRequest().state, /rework the auth layer/);
});

test('downgrade nudges are throttled to one per several prompts', () => {
  const s = session('claude-opus-5-5');
  const first = s.submit('rename the variable foo to bar in utils.js', 'haiku', 0.95);
  assert.ok(first.hookSpecificOutput.additionalContext.includes('haiku'));
  assert.equal(s.submit('rename the variable baz to qux in utils.js', 'haiku', 0.95), null);
  assert.deepEqual(s.log().map((e) => e.action).slice(-2), ['nudge', 'nudge-suppressed']);
});

test('a low-confidence nudge is dropped', () => {
  const s = session('claude-opus-5-5');
  assert.equal(s.submit('rename the variable foo to bar in utils.js', 'haiku', 0.7), null);
});

test('sticky: an easy-sounding follow-up inside a hard task is not reported', () => {
  const s = session('claude-opus-5-5');
  s.submit('redesign the whole renderer architecture across modules', 'opus'); // matches, recorded
  const r = s.submit('also tidy up the helper comments in that file', 'haiku', 0.8);
  assert.equal(r, null);
  assert.equal(s.log().at(-1).reason, 'sticky');
});

test('project instructions and criteria from jev.config.json reach Jev', () => {
  const s = session('claude-opus-5-5');
  fs.writeFileSync(
    path.join(s.project, 'jev.config.json'),
    JSON.stringify({ instructions: 'for a game-dev codebase', criteria: { opus: 'hard', haiku: 'easy' } }),
  );
  s.submit('rename the variable foo to bar in utils.js', 'opus');
  const q = s.jevRequest().questions.model_tier;
  assert.equal(q.instructions, 'for a game-dev codebase');
  assert.deepEqual(q.criteria, { opus: 'hard', haiku: 'easy' });
});

test('skip phrase and env bypass skip everything', () => {
  const s = session('claude-haiku-5-5');
  assert.equal(s.submit('refactor everything [[skip-guard]]', 'opus'), null);
  assert.equal(s.submit('refactor everything now please', 'opus', 0.9, { CLAUDE_SKIP_MODEL_GUARD: '1' }), null);
});

test('no API key fails open', () => {
  const s = session('claude-haiku-5-5');
  assert.equal(s.submit('refactor the auth module across all services', 'opus', 0.9, { TYPESAFE_API_KEY: '' }), null);
});
