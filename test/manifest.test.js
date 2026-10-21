import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('install-time declaration and runtime manifest agree, with no dependencies or new host API', () => {
  for (const [key, value] of Object.entries(pkg.wranglerExtension)) assert.deepEqual(manifest[key], value, key);
  assert.equal(pkg.name, 'agent-wrangler-favicon-badges');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(manifest.engines.wranglerApi, '^1.40.0');
  assert.deepEqual(manifest.requires, []);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(existsSync(join(manifest.dir, manifest.client)), true);
});

test('settings fit existing extension controls with validated hex color inputs', () => {
  assert.equal(manifest.settings[0].key, 'steady');
  assert.equal(manifest.settings[0].type, 'toggle');
  const title = manifest.settings.find((def) => def.key === 'titleStatus');
  assert.equal(title.type, 'toggle');
  assert.equal(title.default, undefined, 'title status remains opt-in');
  for (const def of manifest.settings.filter((def) => def.type === 'text')) {
    const pattern = new RegExp(`^(?:${def.pattern})$`);
    assert.equal(pattern.test(def.placeholder), true);
    assert.equal(pattern.test('"><script/>'), false);
    assert.equal(def.maxLength, 7);
  }
});
