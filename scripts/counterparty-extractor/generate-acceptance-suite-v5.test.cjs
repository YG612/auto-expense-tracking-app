const assert = require('node:assert/strict');
const test = require('node:test');

const { generate } = require('./generate-acceptance-suite-v5.cjs');

test('v5 identifiable-role acceptance suite is balanced and span-valid', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);
  assert.ok(rows.length >= 300);
  assert.ok(positives.length >= 170);
  assert.ok(negatives.length >= 160);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(new Set(rows.map(row => row.scenario)).size >= 15);
  for (const item of positives) {
    assert.equal(
      item.text.slice(item.counterparty.start, item.counterparty.end),
      item.counterparty.text,
    );
  }
});
