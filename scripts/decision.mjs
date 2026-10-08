// The block / nudge / stay-quiet policy, separated from the hook's I/O so it can be tested.
import { TIER_RANK } from './modelState.mjs';

export const DEFAULTS = {
  // Only hard-block when Jev is this confident; a near-coin-flip mismatch just gets a soft nudge.
  blockConfidence: 0.65,
  // Right after a model switch, demand more certainty before blocking again, so a switch isn't
  // immediately second-guessed by the next prompt's coin flip.
  graceConfidence: 0.9,
  gracePrompts: 3, // the resubmitted prompt plus the two after it
  // Running a bigger model than needed only costs money; off by default.
  blockDowngrades: false,
  // Nudges are only worth Claude's one-liner when Jev is fairly sure, and not on every prompt.
  nudgeConfidence: 0.8,
  nudgeEvery: 5, // at most one nudge per this many scored prompts
  // Sticky scoring: a follow-up that sounds easier doesn't mean the hard task is over, so for a
  // few prompts after Jev judged the task needs the current tier (or more), a "downgrade" isn't
  // reported unless Jev is very sure.
  stickyPrompts: 3,
  stickyOverride: 0.9,
};

/**
 * @param {{currentTier: string|null, choice: string, confidence: number,
 *          promptsSinceSwitch: number|null,
 *          history?: {promptCount: number, lastChoice: string|null, lastChoiceAt: number|null}}} s
 * @returns {{action: 'none'|'nudge'|'block', kind?: 'upgrade'|'downgrade'|'other', reason?: string}}
 */
export function decide({ currentTier, choice, confidence, promptsSinceSwitch, history }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (currentTier && currentTier === choice) return { action: 'none' };
  if (!currentTier) return { action: 'nudge', kind: 'other' };

  const cur = TIER_RANK[currentTier];
  const want = TIER_RANK[choice];
  const ranked = cur !== undefined && want !== undefined;
  const kind = !ranked ? 'other' : want > cur ? 'upgrade' : 'downgrade';

  if (kind === 'downgrade' && isSticky(history, cur, confidence, o)) {
    return { action: 'none', kind, reason: 'sticky' };
  }

  const inGrace = promptsSinceSwitch !== null && promptsSinceSwitch < o.gracePrompts;
  const threshold = inGrace ? o.graceConfidence : o.blockConfidence;
  const blockable = kind === 'upgrade' || (kind === 'downgrade' && o.blockDowngrades);

  return { action: blockable && confidence >= threshold ? 'block' : 'nudge', kind };
}

// Recently judged to need at least the current tier, and this prompt isn't a confident reversal.
function isSticky(history, currentRank, confidence, o) {
  if (!history || history.lastChoiceAt === null || history.lastChoiceAt === undefined) return false;
  const prior = TIER_RANK[history.lastChoice];
  if (prior === undefined || prior < currentRank) return false;
  const recent = history.promptCount - history.lastChoiceAt < o.stickyPrompts;
  return recent && confidence < o.stickyOverride;
}

/** Whether a would-be nudge is confident and infrequent enough to actually send. */
export function shouldNudge({ confidence, history }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (confidence < o.nudgeConfidence) return false;
  if (!history || history.lastNudgeAt === null || history.lastNudgeAt === undefined) return true;
  return history.promptCount + 1 - history.lastNudgeAt >= o.nudgeEvery;
}
