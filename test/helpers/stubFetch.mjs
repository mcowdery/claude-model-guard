// STUB_BULK (bulk|other) and STUB_BULK_CONF add the bulk-work answer; without it Jev "omits" it.
// Preloaded with `node --import` to replace Jev with a canned answer. STUB_CHOICE and
// STUB_CONF set the answer; STUB_OUT, if set, receives the request body Jev would have seen.
import fs from 'node:fs';

globalThis.fetch = async (_url, options) => {
  if (process.env.STUB_OUT) fs.writeFileSync(process.env.STUB_OUT, options.body);
  const choice = process.env.STUB_CHOICE;
  const confidence = Number(process.env.STUB_CONF ?? 0.9);
  const answers = {
    model_tier: { choice, confidence, probabilities: { [choice]: confidence } },
  };
  if (process.env.STUB_BULK) {
    const bc = Number(process.env.STUB_BULK_CONF ?? 0.9);
    answers.bulk_work = { choice: process.env.STUB_BULK, confidence: bc, probabilities: { [process.env.STUB_BULK]: bc } };
  }
  return { ok: true, json: async () => ({ answers }) };
};
