// Decides whether a submitted prompt is worth scoring with Jev, and trims it down to the part
// that is. Pure functions, no I/O, so they're easy to test.

// Background-task completions arrive as a synthetic prompt wrapped in <task-notification>, and
// bare "continue"-style replies just resume work already underway. Neither is a new task, so
// scoring them would block a task that is mid-flight on a model that was right when it started.
const TASK_NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/gi;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const PASTED_CONTENT = /(<pasted_content\b[^>]*>)([\s\S]*?)(<\/pasted_content\b[^>]*>)/gi;
const CONTINUATION =
  /^(continue|go on|go ahead|keep going|proceed|resume|ok(ay)?|yes|yep|y|next|carry on)[\s.!]*$/i;
// "/model sonnet", "/clear", "/skill-name args" - but not a pasted path like "/home/me/x is broken".
const SLASH_COMMAND = /^\/[\w:-]+(\s|$)/;
// "!ls" shell mode.
const BANG_COMMAND = /^!\s*\S/;

export const MAX_CHARS = 4000; // cap on what gets sent to Jev
export const PASTE_KEEP = 500; // chars kept from each pasted block (logs, diffs, ...)
export const SHORT_WORDS = 5; // fewer words than this is a follow-up that needs context

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Keep the head and tail of an over-long string; the middle is the least informative part. */
export function clip(text, max = MAX_CHARS) {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half)}\n[...clipped...]\n${text.slice(-half)}`;
}

/** Drop synthetic wrappers and shrink pasted blobs so they don't drown the actual ask. */
export function stripNoise(prompt) {
  return prompt
    .replace(TASK_NOTIFICATION, '')
    .replace(SYSTEM_REMINDER, '')
    .replace(PASTED_CONTENT, (_, open, body, close) =>
      body.length > PASTE_KEEP
        ? `${open}${body.slice(0, PASTE_KEEP)}\n[...${body.length - PASTE_KEEP} more chars of pasted content omitted...]\n${close}`
        : `${open}${body}${close}`,
    )
    .trim();
}

/**
 * @returns {{skip: true, reason: string} | {skip: false, text: string, needsContext: boolean}}
 * `needsContext` means the prompt is too short to judge alone (e.g. "fix that too") and should
 * be scored together with the previous assistant message, or skipped if there isn't one.
 */
export function classifyPrompt(raw) {
  const text = stripNoise(raw ?? '');
  if (!text) return { skip: true, reason: 'empty-or-notification' };
  if (CONTINUATION.test(text)) return { skip: true, reason: 'continuation' };
  if (SLASH_COMMAND.test(text) || BANG_COMMAND.test(text)) return { skip: true, reason: 'command' };
  return { skip: false, text: clip(text), needsContext: wordCount(text) < SHORT_WORDS };
}
