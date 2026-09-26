import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthSecretConfigured } from '../../src/lib/auth/secret.ts';
import { matchesCheckoutScope } from '../../src/lib/auth/checkout-scope.ts';
import { requirePermission } from '../../src/lib/permissions/permissions.ts';

test('published development secret is rejected only in production', () => {
  const secret = 'local-dev-only-auth-secret-min-32-chars-xx';
  assert.throws(() => assertAuthSecretConfigured({ NODE_ENV: 'production', AUTH_SECRET: secret }), /placeholder/);
  assert.equal(assertAuthSecretConfigured({ NODE_ENV: 'development', AUTH_SECRET: secret }), secret);
  assert.throws(() => assertAuthSecretConfigured({ NODE_ENV: 'production', AUTH_SECRET: 'short' }));
  const random = '8f1d5cf686fadb29d1e748a416358d48b8f045a8df0de76a9852500adb0ce8b6';
  assert.equal(assertAuthSecretConfigured({ NODE_ENV: 'production', AUTH_SECRET: random }), random);
});

test('checkout scope rejects switched cafes, switched users and omitted context', () => {
  const user = { businessId: 'cafe-a', id: 'cashier-a' };
  assert.equal(matchesCheckoutScope(user, 'cafe-a:cashier-a'), true);
  for (const scope of ['cafe-b:cashier-a', 'cafe-a:cashier-b', undefined, null, {}, '']) {
    assert.equal(matchesCheckoutScope(user, scope), false);
  }
  assert.deepEqual(user, { businessId: 'cafe-a', id: 'cashier-a' });
});

test('cashier and manager cannot escalate administrative permissions', () => {
  for (const permission of ['staff:write', 'settings:write', 'reports:read', 'expenses:write', 'orders:refund']) {
    assert.throws(() => requirePermission(['cashier'], permission));
  }
  for (const permission of ['staff:write', 'settings:write', 'business:create']) {
    assert.throws(() => requirePermission(['manager'], permission));
  }
  requirePermission(['cashier'], 'orders:create');
  requirePermission(['owner'], 'staff:write');
});
