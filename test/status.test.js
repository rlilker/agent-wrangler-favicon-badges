import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStatus } from '../public/favicon.js';

const session = (status, extra = {}) => ({ managed: true, status, ...extra });

test('favicon combines the whole session graph with failure, input, busy, complete precedence', () => {
  assert.equal(aggregateStatus([]), null);
  assert.equal(aggregateStatus([session('idle')]), 'complete');
  assert.equal(aggregateStatus([session('idle'), session('working')]), 'busy');
  assert.equal(aggregateStatus([session('working'), session('needs-you')]), 'input');
  assert.equal(aggregateStatus([session('working'), session('needs-you'), session('needs-you', { waitingReason: 'api-error' })]), 'failed');
  assert.equal(aggregateStatus([session('needs-you', { waitingFor: 'container bring-up failed' })]), 'failed');
  assert.equal(aggregateStatus([session('idle', { workflow: { phase: { label: 'failed' } } })]), 'failed');
});

test('background jobs and restarting sessions are busy; dormant and unknown sessions cannot mean complete', () => {
  assert.equal(aggregateStatus([session('idle', { hasBackgroundShell: true })]), 'busy');
  assert.equal(aggregateStatus([session('idle', { managed: false, restarting: true })]), 'busy');
  assert.equal(aggregateStatus([session('working', { managed: false })]), null);
  assert.equal(aggregateStatus([session('idle', { managed: false, workflow: { phase: { label: 'failed' } } })]), 'failed', 'dormant failures stay visible even with no live sessions');
  assert.equal(aggregateStatus([session('idle'), session('unknown')]), null);
  assert.equal(aggregateStatus([session('idle'), session('shell')]), null);
});

