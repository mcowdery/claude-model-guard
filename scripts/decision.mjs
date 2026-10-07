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
};

/**
 * @param {{currentTier: string|null, choice: string, confidence: number,
 *          promptsSinceSwitch: number|null}} s
 * @returns {{action: 'none'|'nudge'|'block', kind?: 'upgrade'|'downgrade'|'other'}}
 */
export function decide({ currentTier, choice, confidence, promptsSinceSwitch }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (currentTier && currentTier === choice) return { action: 'none' };
  if (!currentTier) return { action: 'nudge', kind: 'other' };

  const cur = TIER_RANK[currentTier];
  const want = TIER_RANK[choice];
  const ranked = cur !== undefined && want !== undefined;
  const kind = !ranked ? 'other' : want > cur ? 'upgrade' : 'downgrade';

  const inGrace = promptsSinceSwitch !== null && promptsSinceSwitch < o.gracePrompts;
  const threshold = inGrace ? o.graceConfidence : o.blockConfidence;
  const blockable = kind === 'upgrade' || (kind === 'downgrade' && o.blockDowngrades);

  return { action: blockable && confidence >= threshold ? 'block' : 'nudge', kind };
}
