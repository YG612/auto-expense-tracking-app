const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contractPath = path.resolve(
  __dirname,
  '..',
  'docs',
  'AI_AGENT_SYNC_API_V1.openapi.json',
);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const paths = contract.paths;
const create = paths['/v1/agent/operations'].post;
const createSchema = contract.components.schemas.CreatePendingRequest;
const receiptSchema = contract.components.schemas.OperationReceipt;
const claimSchema = contract.components.schemas.ClaimedOperation;
const scopes =
  contract.components.securitySchemes.oauth2.flows.authorizationCode.scopes;

function resolveLocalReference(reference) {
  assert.match(reference, /^#\//u);
  return reference
    .slice(2)
    .split('/')
    .map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, token) => value?.[token], contract);
}

function validateReferences(value) {
  if (Array.isArray(value)) {
    value.forEach(validateReferences);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (typeof value.$ref === 'string') {
    assert.notEqual(
      resolveLocalReference(value.$ref),
      undefined,
      `Unresolved OpenAPI reference: ${value.$ref}`,
    );
  }
  Object.values(value).forEach(validateReferences);
}

assert.equal(contract.openapi, '3.1.0');
assert.equal(contract['x-not-production-ready'], true);
assert.match(contract.servers[0].url, /\.invalid$/u);
validateReferences(contract);
assert.equal(createSchema.additionalProperties, false);
assert.equal(createSchema.properties.command.const, 'bill.create-pending');
assert.equal(createSchema.properties.text.maxLength, 500);
assert.equal(receiptSchema.additionalProperties, false);
assert.equal(Object.hasOwn(receiptSchema.properties, 'text'), false);
assert.equal(Object.hasOwn(receiptSchema.properties, 'authorization'), false);
assert.equal(Object.hasOwn(receiptSchema.properties, 'accountBalance'), false);
assert.equal(claimSchema.properties.text.maxLength, 500);
assert.deepEqual(Object.keys(scopes).sort(), [
  'agent.device.operation:claim',
  'agent.device.operation:complete',
  'agent.device:read',
  'agent.operation:cancel',
  'agent.operation:read',
  'agent.pending:create',
]);
assert.equal(
  paths['/v1/agent/operations/{operationId}:cancel'].post.parameters.some(
    parameter => parameter.$ref === '#/components/parameters/IfMatch',
  ),
  true,
);
assert.equal(
  paths[
    '/v1/device/agent/operations/{operationId}:complete'
  ].post.parameters.some(
    parameter => parameter.$ref === '#/components/parameters/IfMatch',
  ),
  true,
);
assert.deepEqual(paths['/v1/device/agent/operations:claim'].post.security, [
  { oauth2: ['agent.device.operation:claim'] },
]);
assert.match(
  contract.components.headers.OperationRevision.schema.pattern,
  /\[1-9\]/u,
);
for (const [route, pathItem] of Object.entries(paths)) {
  for (const operation of Object.values(pathItem)) {
    if (typeof operation !== 'object' || operation === null) continue;
    const grantedScopes = (operation.security ?? []).flatMap(
      requirement => requirement.oauth2 ?? [],
    );
    if (route.startsWith('/v1/agent/')) {
      assert.equal(
        grantedScopes.some(scope =>
          scope.startsWith('agent.device.operation:'),
        ),
        false,
      );
      assert.doesNotMatch(
        JSON.stringify(operation.responses),
        /ClaimedOperation/u,
      );
    }
    if (route.startsWith('/v1/device/')) {
      assert.equal(
        grantedScopes.every(scope =>
          scope.startsWith('agent.device.operation:'),
        ),
        true,
      );
    }
  }
}
assert.equal(
  create.parameters.some(
    parameter => parameter.$ref === '#/components/parameters/IdempotencyKey',
  ),
  true,
);
assert.equal(
  create.parameters.some(
    parameter => parameter.$ref === '#/components/parameters/PayloadSha256',
  ),
  true,
);
assert.equal(
  Object.values(paths).some(pathItem =>
    Object.values(pathItem).some(
      operation =>
        typeof operation === 'object' &&
        operation !== null &&
        /confirm|deleteLedger|sql|queryLedger/iu.test(
          String(operation.operationId ?? ''),
        ),
    ),
  ),
  false,
);

process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, status: 'PASS', contract: path.basename(contractPath) })}\n`,
);
