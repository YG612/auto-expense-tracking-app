'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const {
  extractAmountSequenceFen,
  extractNumberSequence,
  parseJsonLines,
} = require('./score-asr-ab.cjs');

const manifestPath = path.join(__dirname, 'financial-smoke-manifest.jsonl');
const baseCases = parseJsonLines(readFileSync(manifestPath, 'utf8'), manifestPath)
  .filter(entry => Number.parseInt(entry.id.slice(4), 10) <= 22);

const amounts = [3, 5, 7, 9, 12, 15, 18, 20, 25, 28, 32, 35, 48, 50, 68, 88, 120, 200];
const environments = ['clean', 'cafe_noise', 'road_noise', 'music_noise', 'distant_mic'];
const accents = ['standard_mandarin', 'southern_mandarin', 'sichuan_mandarin', 'northern_erhua'];

const templates = [
  amount => ({ text: `今天早餐花了${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['expense', 'food'] }),
  amount => ({ text: `8月10号打车花了${amount}元`, amounts: [amount], numbers: [8, 10, amount], ledger: amount, tags: ['expense', 'transport', 'date'] }),
  amount => ({ text: `午饭${amount}元晚饭${amount + 7}元`, amounts: [amount, amount + 7], numbers: [amount, amount + 7], ledger: amount * 2 + 7, tags: ['expense', 'multi_transaction'] }),
  amount => ({ text: `商家退款${amount}元到微信`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['refund', 'account'] }),
  amount => ({ text: `收到兼职收入${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['income'] }),
  amount => ({ text: `支付宝转给小王${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['transfer', 'account'] }),
  amount => ({ text: `公司报销到账${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['reimbursement'] }),
  amount => ({ text: `用银行卡还款${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['repayment', 'account'] }),
  amount => ({ text: `买药花了${amount}元微信付的`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['expense', 'medical', 'account'] }),
  amount => ({ text: `先停顿再说买水果花了${amount}元`, amounts: [amount], numbers: [amount], ledger: amount, tags: ['expense', 'pause_mid_utterance'] }),
  amount => ({ text: `本来想花${amount}元但是最后没买`, amounts: [amount], numbers: [amount], ledger: null, tags: ['planned', 'negation', 'no_transaction'] }),
  amount => ({ text: `买2张票每张${amount}元`, amounts: [amount], numbers: [2, amount], ledger: amount * 2, tags: ['expense', 'quantity_unit_price'] }),
];

const generated = [];
let sequence = 23;
for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
  for (let amountIndex = 0; amountIndex < amounts.length; amountIndex += 1) {
    const spec = templates[templateIndex](amounts[amountIndex]);
    const id = `fin-${String(sequence).padStart(3, '0')}`;
    const expectedFen = spec.amounts.map(value => value * 100);
    if (JSON.stringify(extractAmountSequenceFen(spec.text)) !== JSON.stringify(expectedFen)) {
      throw new Error(`${id}: generated amount sequence is inconsistent`);
    }
    if (JSON.stringify(extractNumberSequence(spec.text)) !== JSON.stringify(spec.numbers)) {
      throw new Error(`${id}: generated number sequence is inconsistent`);
    }
    generated.push({
      id,
      audioFile: `recordings/${id}.wav`,
      referenceText: spec.text,
      expectedOutcome: 'TRANSCRIBE',
      expectedAmountSequenceFen: expectedFen,
      expectedNumberSequence: spec.numbers,
      expectedLedgerAmountFen: spec.ledger === null ? null : spec.ledger * 100,
      sceneTags: spec.tags,
      environment: environments[(templateIndex + amountIndex) % environments.length],
      accentProfile: accents[(templateIndex * 3 + amountIndex) % accents.length],
      requiresFullAudio: true,
      recordingPromptGroup: `generated-${String(templateIndex + 1).padStart(2, '0')}`,
    });
    sequence += 1;
  }
}

const allCases = [...baseCases, ...generated];
if (allCases.length < 200) throw new Error('financial manifest must contain at least 200 cases');
writeFileSync(manifestPath, `${allCases.map(entry => JSON.stringify(entry)).join('\n')}\n`);
process.stdout.write(`Generated ${allCases.length} financial ASR cases.\n`);
