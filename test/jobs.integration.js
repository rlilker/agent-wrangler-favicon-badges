// Explicit compatibility check against an existing Wrangler² checkout. No
// dependency or source from that extension is shipped by this package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createJobAttention } from '../public/job-attention.js';

test('Wrangler² canonical attention rule covers decisions, failures, budget and prompts without session duplicates', async () => {
  assert.ok(process.env.AW_TEST_JOBS_REPO, 'set AW_TEST_JOBS_REPO to a Wrangler² checkout');
  const module = await import(pathToFileURL(resolve(process.env.AW_TEST_JOBS_REPO, 'public/job-state.js')).href);
  const sub = (extra = {}) => ({ id: 'step', kind: 'pr', stage: 'implementation', state: 'queued', after: [], sessions: [], ...extra });
  const job = (extra = {}) => ({ id: 'job', stage: 'active', runs: [], subJobs: [sub()], ...extra });
  const cases = [
    ['working', job({ runs: [{ subJobId: 'step', sessionId: 'worker', status: 'working' }] }), false],
    ['local review', job({ subJobs: [sub({ stage: 'review', state: 'verified' })] }), true],
    ['reported failure', job({ subJobs: [sub({ stage: 'review', error: 'Example failure' })] }), true],
    ['budget decision', job({ budgetPaused: { usd: 1 } }), true],
    ['native worker prompt', job({ runs: [{ sessionId: 'worker', subJobId: 'step', status: 'needs-you' }] }), true],
    ['plan approval', job({ stage: 'planning', plan: { subJobs: [] }, subJobs: [] }), true],
    ['completed', job({ stage: 'done', subJobs: [sub({ stage: 'done' })] }), false],
  ];
  for (const [name, fixture, expected] of cases) {
    assert.equal(!!module.jobNeedsYou(fixture), expected, name);
    const attention = createJobAttention({ load: async () => module, changed() {} });
    attention.update([], { jobs: [fixture] }, true);
    await new Promise((resolve) => setImmediate(resolve));
    const result = attention.update([{ sessionId: 'worker', managed: true, status: 'needs-you' }], { jobs: [fixture] }, true);
    assert.equal(result.jobCount, Number(expected), name);
    if (name === 'native worker prompt') assert.deepEqual(result.sessions, [], 'job and worker count only once');
    attention.dispose();
  }
});
