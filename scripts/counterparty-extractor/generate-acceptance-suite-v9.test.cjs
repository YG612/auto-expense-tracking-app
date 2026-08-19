const assert = require('node:assert/strict');
const test = require('node:test');
const { generate } = require('./generate-acceptance-suite-v9.cjs');

test('v9 blind suite is balanced, difficult, and span-valid', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);
  assert.ok(rows.length >= 350);
  assert.ok(positives.length >= 170);
  assert.ok(negatives.length >= 180);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(
    rows.filter(row => row.scenario === 'V9_LOCATION_MODIFIER').length >= 30,
  );
  assert.ok(
    rows.filter(row => row.scenario === 'V9_CANCELLED_TRANSACTION').length >=
      30,
  );
  for (const item of positives) {
    assert.equal(
      item.text.slice(item.counterparty.start, item.counterparty.end),
      item.counterparty.text,
    );
  }
});
