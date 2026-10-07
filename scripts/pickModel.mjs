// Picks which Claude Code model tier fits a task, using Jev (Typesafe's classifier model:
// a "choice" question over fixed options, not a conversational LLM) instead of spending a
// real model's tokens on the decision. `npm run model:pick -- "<task description>"` prints the
// tier to stdout; `--launch` execs `claude --model <tier>` (plus any args after `--launch`) so a
// session can start on the right model without thinking about it.
import { spawn } from 'node:child_process';
import { pickTier, rankedProbabilities } from './jev.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const launch = rawArgs.includes('--launch');
  const withoutLaunch = rawArgs.filter((a) => a !== '--launch');
  const sepIdx = withoutLaunch.indexOf('--');
  const args = sepIdx === -1 ? withoutLaunch : withoutLaunch.slice(0, sepIdx);
  const passthrough = sepIdx === -1 ? [] : withoutLaunch.slice(sepIdx + 1);

  const taskText = args.join(' ').trim() || (await readStdin());
  if (!taskText) {
    console.error('Usage: npm run model:pick -- "<task description>" [--launch] [-- <claude args>]');
    process.exit(1);
  }

  const answer = await pickTier(taskText);
  console.error(`${answer.choice} (confidence ${Math.round(answer.confidence * 100)}%; ${rankedProbabilities(answer)})`);

  if (launch) {
    const child = spawn('claude', ['--model', answer.choice, ...passthrough], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    console.log(answer.choice);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
