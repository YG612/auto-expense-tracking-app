const assert = require('node:assert/strict');
const test = require('node:test');

const { generate } = require('./generate-acceptance-suite.cjs');

test('locked acceptance rows are large, balanced, and have exact spans', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);

  assert.ok(rows.length >= 250);
  assert.ok(positives.length >= 100);
  assert.ok(negatives.length >= 100);
  assert.ok(rows.every(row => row.split === 'acceptance'));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);

  for (const row of positives) {
    assert.equal(
      row.text.slice(row.counterparty.start, row.counterparty.end),
      row.counterparty.text,
    );
  }
});

test('acceptance suite covers difficult negative and role-conflict scenarios', () => {
  const scenarios = new Set(generate().map(row => row.scenario));
  for (const expected of [
    'ACCEPT_HYPOTHETICAL',
    'ACCEPT_BRAND_PRODUCT',
    'ACCEPT_MENTION_ONLY',
    'ACCEPT_BENEFICIARY',
    'ACCEPT_COMPANION',
    'ACCEPT_ORGANIZATION_PRODUCT',
    'ACCEPT_ROUTE',
    'ACCEPT_STATION',
    'ACCEPT_PLATFORM_PROVIDER',
  ]) {
    assert.ok(scenarios.has(expected), expected);
  }
});
