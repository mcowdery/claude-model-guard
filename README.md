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
  recorded model, and:
  - **matches** → says nothing.
  - **confidently disagrees** → **blocks the prompt** with a reason, so it never runs on the
    wrong model. Switch models and resubmit.
  - **current model unknown yet, or the mismatch is too close to call** → doesn't block, just
    hands Claude a short note it can mention to you if relevant.

There's also a small interactive CLI (`pickModel.mjs`) for picking a model tier *before* you
start a session, independent of the hooks.

## Before you start

You need a **Typesafe API key**. As of this writing, Jev is early access / on a waitlist at
[typesafe.ai](https://typesafe.ai) — this tool is not useful without one, so get access first.

You also need an existing Claude Code project (any language, any size) with a `.claude/`
directory, and Node.js 18+ (for the global `fetch`).

## Install

Clone this repo, or just copy the `scripts/` folder into your project:

```sh
git clone https://github.com/mcowdery/claude-model-guard.git
cp -r claude-model-guard/scripts your-project/scripts/model-guard
```

Then, in your project:

1. **Add your API key.** Copy `.env.jev.example` to `.env.jev` at your project's root and fill
   in `TYPESAFE_API_KEY`. `.env.jev` is meant to be git-ignored — don't commit it.

2. **Register the hooks.** Add this to `.claude/settings.json` (shared with your team) or
   `.claude/settings.local.json` (personal, git-ignored — recommended while you're still
   deciding whether you like this) — adjust the path if you copied `scripts/` somewhere else:

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

- `BLOCK_CONFIDENCE` in `promptAdvisor.mjs` (default `0.65`) controls how confident Jev has to
  be before a mismatch becomes a hard block instead of a soft nudge. Lower it to block more
  readily; raise it to only ever block on near-certain calls.
- `jev.config.json` controls what Jev is actually judging — see above.

## Known limitations

- **The very first prompt of a session can't be checked reliably.** `SessionStart`'s `model`
  field isn't always populated (e.g. after `/clear` or a restored session), so until the first
  real model switch happens, there's nothing to compare against — that one prompt falls back to
  advisory-only.
- **Verify `PostModelSwitch` actually fires for your setup.** It's confirmed to fire from the
  `/model` CLI command. If you're driving Claude Code through an IDE extension's own model
  picker UI, confirm it fires there too before trusting the block behavior.
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
