const assert = require('node:assert/strict');
const test = require('node:test');

const { generate } = require('./generate-acceptance-suite-v4.cjs');

test('v4 locked acceptance suite is balanced and span-valid', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);
  assert.ok(rows.length >= 300);
  assert.ok(positives.length >= 150);
  assert.ok(negatives.length >= 150);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(new Set(rows.map(row => row.scenario)).size >= 15);
  for (const row of positives) {
    assert.equal(
      row.text.slice(row.counterparty.start, row.counterparty.end),
      row.counterparty.text,
    );
  }
});
