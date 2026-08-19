const assert = require('node:assert/strict');
const test = require('node:test');

const { generate } = require('./generate-synthetic-data.cjs');

test('synthetic counterparty rows have valid exact spans and isolated entity pools', () => {
  const rows = generate();
  assert.ok(rows.length >= 3000);
  for (const row of rows) {
    if (row.counterparty !== null) {
      assert.equal(
        row.text.slice(row.counterparty.start, row.counterparty.end),
        row.counterparty.text,
      );
    }
  }
  const merchantSplits = new Map();
  for (const row of rows.filter(row =>
    row.splitGroup.startsWith('merchant:'),
  )) {
    const existing = merchantSplits.get(row.splitGroup);
    assert.ok(existing === undefined || existing === row.split);
    merchantSplits.set(row.splitGroup, row.split);
  }
});

test('route, brand, channel, beneficiary and out-of-template difficulties are present', () => {
  const rows = generate();
  const difficulties = new Set(rows.map(row => row.difficulty));
  for (const expected of [
    'HARD_ROUTE_LOCATION',
    'HARD_BRAND_PRODUCT',
    'HARD_CHANNEL',
    'HARD_BENEFICIARY',
    'HARD_MULTI_ENTITY',
    'HARD_OUT_OF_TEMPLATE',
  ]) {
    assert.ok(difficulties.has(expected), expected);
  }
  assert.ok(
    rows
      .filter(row => row.difficulty === 'HARD_OUT_OF_TEMPLATE')
      .every(row => row.split === 'frozenTest'),
  );
});
