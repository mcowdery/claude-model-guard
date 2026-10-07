# claude-model-guard

Pick, and optionally *enforce*, the right [Claude Code](https://claude.com/claude-code) model
tier for every prompt — without having to think about it yourself.

It uses [Jev](https://typesafe.ai), a classifier model (not a conversational LLM) that reads a
piece of text and returns one of a fixed set of labeled options with a confidence score. That
makes it a near-free, near-instant way to answer one question on every prompt you type: *"does
this look like Haiku work, Sonnet work, Opus work, or long-form writing work?"* — far cheaper
than spending a real model's tokens on the decision.

## What it actually does

Three Claude Code hooks, working together:

- **`SessionStart` / `PostModelSwitch`** → record which model the session is actually running
  right now (a tiny state file, nothing fancy).
- **`UserPromptSubmit`** → on every prompt, asks Jev which tier fits it, compares that to the
  running model, and:
  - **matches** → says nothing.
  - **Jev confidently wants a more capable tier** (haiku → sonnet → opus) → **blocks the
    prompt** with a reason, so it never runs on an under-powered model. Switch and resubmit.
  - **anything else** (a downgrade, fable, current model unknown, a close call) → doesn't
    block, just hands Claude a short note it can mention to you if relevant. Running a bigger
    model than needed only costs money; set `CLAUDE_GUARD_BLOCK_DOWNGRADES=1` to block those too.

What it deliberately does **not** score: background-task completion notifications, slash
commands (`/model`, `/clear`, ...), `!` shell commands, and bare replies like "continue" or
"yes" — these carry on work already underway, and scoring them blocked tasks mid-flight. Very
short follow-ups ("fix that too") are scored together with Claude's previous message, or skipped
if there isn't one. Long prompts are clipped and pasted blobs shrunk so logs don't drown the ask.

The running model is read from the session transcript (every assistant message records its
model) and the switch-tracking state file, whichever is newer. For the first few prompts after
you switch models the block threshold is raised (0.9 instead of 0.65) so a switch isn't
immediately second-guessed.

There's also a small interactive CLI (`pickModel.mjs`) for picking a model tier *before* you
start a session, independent of the hooks.

## Before you start

You need a **Typesafe API key**. As of this writing, Jev is early access / on a waitlist at
[typesafe.ai](https://typesafe.ai) — this tool is not useful without one, so get access first.

You also need an existing Claude Code project (any language, any size) with a `.claude/`
directory, and Node.js 18+ (for the global `fetch`).

## Install

Clone this repo **once**; every project points at that one checkout, so a `git pull` updates
them all (no per-project copies to drift out of date):

```sh
git clone https://github.com/mcowdery/claude-model-guard.git
node claude-model-guard/scripts/install.mjs --project path/to/your-project   # personal settings.local.json
node claude-model-guard/scripts/install.mjs --global                          # or: every project
```

`install.mjs` is idempotent, keeps your other hooks, and supports `--shared` (use the
project's `settings.json`), `--uninstall` and `--dry-run`. Don't combine `--global` with a
project install, or the hooks run twice. Your project still supplies its own `.env.jev` and
`jev.config.json`; they're looked up in the project directory, not in the clone.

Then, in your project:

1. **Add your API key.** Copy `.env.jev.example` to `.env.jev` at your project's root and fill
   in `TYPESAFE_API_KEY`. `.env.jev` is meant to be git-ignored — don't commit it.

2. **Register the hooks** — `install.mjs` above does this. To do it by hand instead, add this
   to `.claude/settings.json` (shared with your team) or `.claude/settings.local.json`
   (personal, git-ignored) after copying `scripts/` into your project:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/model-guard/promptAdvisor.mjs\"" }] }
       ],
       "PostModelSwitch": [
         { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/model-guard/recordModelSwitch.mjs\"" }] }
       ],
       "SessionStart": [
         { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/model-guard/recordModelSwitch.mjs\"" }] }
       ]
     }
   }
   ```

3. **(Optional) Customize the criteria.** Copy `jev.config.example.json` to `jev.config.json` at
   your project's root and rewrite the descriptions to fit your own codebase and judgment calls.
   The keys are exactly the model tiers Jev is asked to choose between — add, remove, or rename
   them freely (whatever's there is what the hooks compare against). Without this file, generic
   defaults are used.

That's it — no npm install, no dependency, just Node's built-in `fetch`.

## Using the CLI picker

Independent of the hooks, for picking a model *before* you start a session:

```sh
npm run model:pick -- "fix the off-by-one in the pagination component"
# -> sonnet (confidence 91%; sonnet 91%, haiku 8%, opus 1%, fable 0%)

npm run model:pick -- "refactor this task" --launch
# -> picks a tier, then execs `claude --model <tier>` for you
```

## Escape hatches

If the guard ever blocks something you want to run anyway:

- Switch to the suggested model and resubmit (the intended path).
- Set `CLAUDE_SKIP_MODEL_GUARD=1` in your environment to bypass entirely.
- Add `[[skip-guard]]` anywhere in the prompt text to bypass just that one prompt (it stays
  visible in the transcript — hooks can't rewrite what you typed, only react to it).

## Tuning

- Every decision (including skips) is appended to `.claude/model-guard.log.jsonl` in the
  project: when, the first 120 chars of the prompt, Jev's pick and confidence, the running tier,
  and what the hook did. Add it to your `.gitignore` (it contains prompt text), and review it
  before changing thresholds. Set `CLAUDE_GUARD_LOG=0` to turn it off.
- `DEFAULTS` in `scripts/decision.mjs` holds the thresholds: `blockConfidence` (0.65, how sure
  Jev must be to block instead of nudge), `graceConfidence` (0.9) and `gracePrompts` (3) for the
  period after a model switch, and `blockDowngrades`.
- `jev.config.json` controls what Jev is actually judging — see above.
- `npm test` runs the unit tests (Node's built-in runner, no dependencies).

## Known limitations

- **The very first prompt of a brand-new session** has no assistant message in the transcript
  yet, and `SessionStart`'s `model` field isn't always populated, so that one prompt can fall
  back to advisory-only. Later prompts read the model from the transcript.
- Right after a model switch, the transcript still shows the old model until Claude replies; the
  state file written by `PostModelSwitch` covers that gap. `PostModelSwitch` is confirmed to
  fire from the `/model` CLI command; if you switch via an IDE extension's picker and it doesn't
  fire, the transcript catches up after one reply.
- Cost is small but not zero: one Jev call per prompt. At Jev's published rate ($0.042 per
  million input tokens, output free), a typical call (criteria text plus your prompt) runs
  roughly $0.00002–$0.00003 — about 2–3 cents per 1,000 prompts.
- This cannot add a custom entry to a Claude Code IDE extension's native model-picker dropdown,
  and no documented Claude Code hook can programmatically select which model handles a turn —
  blocking a mismatched prompt is the closest real enforcement available today.

## How this was built

Through a Claude Code session, end to end — including finding (and fixing) a Windows-specific
crash from calling `process.exit()` right after a `fetch()` resolved, and catching a subagent
that confidently hallucinated a hook API that doesn't exist. Both are the kind of thing worth
knowing before you trust any of this blindly — read the scripts, they're short.

## License

MIT - see [LICENSE](LICENSE).
