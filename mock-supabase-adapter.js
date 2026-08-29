/**
 * TenderAlert — Mock Supabase Adapter
 *
 * Behaves like a future real Supabase insertion client's interface, but
 * stores nothing remotely and makes no network calls of any kind. Purely
 * in-memory, for isolated testing only.
 *
 * A future REAL adapter would implement the exact same `insert(record)`
 * interface using the actual Supabase client and a server-side write-capable
 * credential supplied via environment configuration — never hardcoded, and
 * never present in this file or any client-side code.
 */

'use strict';

function createMockSupabaseAdapter(options) {
  options = options || {};
  const attempts = [];
  let idCounter = 0;

  return {
    async insert(record) {
      // Record the attempt regardless of outcome — tests need to see every
      // call that was actually made, not just successful ones.
      attempts.push(record);

      if (options.simulateFailure) {
        throw new Error(options.failureMessage || 'Simulated database failure (mock adapter)');
      }

      idCounter++;
      // Simulate what a real Supabase insert would hand back: the record
      // plus the two DB-generated columns (id, created_at) that this
      // pipeline never sets itself.
      return Object.assign({}, record, {
        id: options.mockId || ('mock-id-' + idCounter),
        created_at: options.mockCreatedAt || new Date().toISOString()
      });
    },

    getAttempts() {
      return attempts;
    },

    getAttemptCount() {
      return attempts.length;
    }
  };
}

module.exports = { createMockSupabaseAdapter };
