const assert = require('node:assert/strict');
const test = require('node:test');
const { generate } = require('./generate-acceptance-suite-v7.cjs');

test('v7 final blind suite is balanced and span-valid', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);
  assert.ok(rows.length >= 330);
  assert.ok(positives.length >= 150);
  assert.ok(negatives.length >= 165);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const item of positives)
    assert.equal(
      item.text.slice(item.counterparty.start, item.counterparty.end),
      item.counterparty.text,
    );
});
