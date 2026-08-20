import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/utils/errors.js';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
const { hasMinimumRole } = await import('../src/auth.js');

test('RBAC role hierarchy is explicit and denies unknown roles', () => {
  assert.equal(hasMinimumRole('admin', 'operator'), true);
  assert.equal(hasMinimumRole('owner', 'admin'), true);
  assert.equal(hasMinimumRole('viewer', 'operator'), false);
  assert.equal(hasMinimumRole('root', 'admin'), false);
});

test('AppError keeps safe details for client-facing failures', () => {
  const error = new AppError(409, 'CONFLICT', { details: { field: 'username' } });
  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFLICT');
  assert.equal(error.expose, true);
  assert.deepEqual(error.details, { field: 'username' });
});
