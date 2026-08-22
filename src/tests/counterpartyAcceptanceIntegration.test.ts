import { resolveCounterpartyFromRules } from '../classification/counterparty/counterpartyExtractor';

type AcceptanceRow = {
  id: string;
  text: string;
  counterparty: null | { text: string; start: number; end: number };
};

const v9 =
  require('../../scripts/counterparty-extractor/generate-acceptance-suite-v9.cjs') as {
    generate(): AcceptanceRow[];
  };
const v10 =
  require('../../scripts/counterparty-extractor/generate-acceptance-suite-v10.cjs') as {
    generate(): AcceptanceRow[];
  };

describe('app counterparty acceptance parity', () => {
  it.each([
    ['v9', v9.generate()],
    ['v10', v10.generate()],
  ] as const)(
    'matches every deterministic %s acceptance row',
    (_name, rows) => {
      const errors = rows.flatMap(row => {
        const actual = resolveCounterpartyFromRules(row.text);
        const expected = row.counterparty;
        return actual?.text === expected?.text &&
          actual?.start === expected?.start &&
          actual?.end === expected?.end
          ? []
          : [
              `${row.id}: expected=${expected?.text ?? 'null'} actual=${actual?.text ?? 'null'} text=${row.text}`,
            ];
      });
      expect(errors).toEqual([]);
    },
  );
});
