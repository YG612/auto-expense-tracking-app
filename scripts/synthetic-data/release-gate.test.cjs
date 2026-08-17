const assert = require('node:assert/strict');
const test = require('node:test');

const { verifyIndependentReview } = require('./verify-release-datasets.cjs');

const row = {
  id: 'syn-cat-0000001',
  generatorModel: 'generator-a',
  promptVersion: 'training-v1',
};

function audit(overrides = {}) {
  return `${JSON.stringify({
    id: row.id,
    verdict: 'ACCEPT',
    reviewerModel: 'reviewer-b',
    reviewerPromptVersion: 'independent-review-v1',
    reviewedPromptVersion: row.promptVersion,
    ...overrides,
  })}\n`;
}

test('release evidence binds every accepted row to an isolated judge', () => {
  const result = verifyIndependentReview([row], audit(), 'test audit');
  assert.deepEqual(result.reviewerModels, ['reviewer-b']);
  assert.throws(
    () =>
      verifyIndependentReview(
        [row],
        audit({ reviewerModel: row.generatorModel }),
        'test audit',
      ),
    /isolated independent ACCEPT/u,
  );
  assert.throws(
    () =>
      verifyIndependentReview(
        [row],
        audit({ verdict: 'REJECT' }),
        'test audit',
      ),
    /isolated independent ACCEPT/u,
  );
});

test('Codex-local deterministic review is explicitly distinguished', () => {
  const row = {
    id: 'syn-cat-one',
    promptVersion: 'codex-training-v1',
    generatorModel: 'openai-codex-current/generator-pass-v1',
  };
  const auditText = `${JSON.stringify({
    id: row.id,
    verdict: 'ACCEPT',
    reviewerModel: 'deterministic-validator/codex-authored-rules-v1',
    reviewerPromptVersion: 'deterministic-review-v1',
    reviewedPromptVersion: row.promptVersion,
    reviewMode: 'DETERMINISTIC_VALIDATOR',
  })}\n`;
  assert.deepEqual(
    verifyIndependentReview([row], auditText, 'deterministic audit')
      .reviewModes,
    ['DETERMINISTIC_VALIDATOR'],
  );
});
