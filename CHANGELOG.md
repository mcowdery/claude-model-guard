# Changelog

## 1.2.0

Added
- Bulk-work hint: the per-prompt Jev request now carries a second question, "is this mostly the
  same simple judgment over many items?" (labelling issues, ranking files, triaging failures).
  When Jev is 80%+ sure, the hook adds a note telling Claude to batch those items through a Jev
  MCP tool (for example `jev_decide`, `jev_rank`, `jev_evaluate`) if one is available, and to
  ignore the note otherwise. It never blocks and is independent of the model-tier decision.
  `CLAUDE_GUARD_BULK=0` turns it off. The decision log records `bulk`, `bulkConfidence` and
  `bulkHint`.
- The Typesafe key is also read from `~/.claude/.env.jev` (after the environment and the project's
  `.env.jev`), so one key serves every project with a global install.
- `askJev()` in `scripts/jev.mjs` sends both questions in one request; `pickTier()` is unchanged.

## 1.1.0

Fixes
- Background-task completion notifications and bare "continue" replies are no longer scored, so a
  task no longer gets blocked mid-flight and needs a manual "continue".

Changed behaviour
- The guard blocks only when Jev wants a *more capable* tier (haiku < sonnet < opus). Downgrades,
  fable and an unknown current model only produce a nudge. `CLAUDE_GUARD_BLOCK_DOWNGRADES=1`
  restores blocking for downgrades.
- Nudges are sent only at 80%+ confidence and at most once per 5 scored prompts.
- Sticky scoring: for 3 prompts after a task was judged to need at least the current tier, a
  softer-sounding follow-up is not reported as a downgrade.
- For 3 prompts after a model switch the block threshold rises from 0.65 to 0.9.

Added
- The running model is read from the session transcript as well as the switch-tracking state
  file (newest wins), so IDE-picker switches no longer leave it stale.
- Slash commands, `!` commands and very short replies are handled without a blind Jev call;
  short follow-ups are scored together with Claude's previous message.
- Long prompts are clipped and pasted blobs shrunk before they go to Jev.
- `jev.config.json` accepts `{ "instructions": "...", "criteria": { ... } }` (the flat form
  still works) so Jev can be told what kind of codebase this is.
- Decision log at `.claude/model-guard.log.jsonl`, rotated at 1 MB.
- `scripts/install.mjs` registers the hooks against one shared checkout (`--global`,
  `--project`, `--shared`, `--uninstall`, `--dry-run`).
- Unit and end-to-end tests (`npm test`), `.gitattributes`.

## 1.0.0

Initial release.
