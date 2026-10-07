// PostModelSwitch / SessionStart hook: records which model the session is actually running,
// so promptAdvisor.mjs (UserPromptSubmit) can block on a confident tier mismatch instead of
// only ever advising. Side-effect only - never blocks, never emits a decision of its own, and
// any failure here just means the next prompt falls back to advisory mode.
import { writeCurrentModel } from './modelState.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return;
  }
  // PostModelSwitch carries `to_model`; SessionStart carries `model` (and only sometimes).
  const modelId = input?.to_model ?? input?.model;
  writeCurrentModel(input, modelId);
}

main().catch(() => {});
