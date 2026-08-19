const assert = require('node:assert/strict');
const test = require('node:test');
const { generate } = require('./generate-acceptance-suite-v10.cjs');

test('v10 quantized-model blind suite is balanced and span-valid', () => {
  const rows = generate();
  const positives = rows.filter(row => row.counterparty !== null);
  const negatives = rows.filter(row => row.counterparty === null);
  assert.equal(rows.length, 315);
  assert.equal(positives.length, 150);
  assert.equal(negatives.length, 165);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const item of positives) {
    assert.equal(
      item.text.slice(item.counterparty.start, item.counterparty.end),
      item.counterparty.text,
    );
  }
});
