/**
 * TenderAlert — Supabase Adapter Test Suite
 *
 * fetch() is fully replaced with a fake implementation for every test —
 * this file NEVER makes a real network call, NEVER contacts real Supabase,
 * and only ever uses obviously-synthetic placeholder env values (never a
 * real credential of any kind).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createSupabaseAdapter } = require('./supabase-adapter');

let pass = 0;
let fail = 0;

function check(label, condition, detail) {
  condition ? pass++ : fail++;
  console.log((condition ? '  PASS ' : '  FAIL ') + label + (detail ? ' — ' + detail : ''));
}

const FAKE_URL = 'https://fake-test-project.supabase.co';
const FAKE_KEY = 'fake-test-service-role-key-not-real';

function withFakeEnv(fn) {
  return async () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const originalFetch = global.fetch;
    try {
      await fn();
    } finally {
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
      global.fetch = originalFetch;
    }
  };
}

function fakeFetch(implementation) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return implementation(url, opts);
  };
  fn.getCalls = () => calls;
  fn.getCallCount = () => calls.length;
  return fn;
}

function sampleRecord() {
  return {
    Title: 'Construction of District Roads',
    Sector: 'Construction',
    Organization: 'Ministry of Works',
    Location: 'Kampala',
    deadline: '2027-09-28',
    reference: 'PPDA/DEMO/2026/001',
    match_percentage: null,
    summary: 'A sample summary.',
    buyer_wants: 'A sample buyer_wants statement.',
    eligibility: 'A sample eligibility statement.',
    Requirements: JSON.stringify(['Requirement A']),
    Documents: JSON.stringify(['Document A'])
  };
}

async function main() {
  console.log('=== ENV VAR VALIDATION ===');

  await withFakeEnv(async () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{}] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('1. Missing SUPABASE_URL -> throws clearly', threw && message.includes('SUPABASE_URL'));
    check('1b. No fetch attempted when SUPABASE_URL missing', fake.getCallCount() === 0);
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{}] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('2. Missing SUPABASE_SERVICE_ROLE_KEY -> throws clearly', threw && message.includes('SUPABASE_SERVICE_ROLE_KEY'));
    check('2b. No fetch attempted when key missing', fake.getCallCount() === 0);
  })();

  console.log('');
  console.log('=== id / created_at REFUSAL (checked BEFORE any env read or network call) ===');

  await withFakeEnv(async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{}] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    const record = { ...sampleRecord(), id: 42 };
    let threw = false;
    let message = '';
    try {
      await adapter.insert(record);
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('3. Record containing "id" -> refused', threw && message.includes('id or created_at'));
    check('3b. No fetch attempted, no env even required', fake.getCallCount() === 0);
  })();

  await withFakeEnv(async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{}] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    const record = { ...sampleRecord(), created_at: '2026-01-01T00:00:00Z' };
    let threw = false;
    let message = '';
    try {
      await adapter.insert(record);
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('4. Record containing "created_at" -> refused', threw && message.includes('id or created_at'));
    check('4b. No fetch attempted', fake.getCallCount() === 0);
  })();

  console.log('');
  console.log('=== SUCCESSFUL INSERT ===');

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;

    const returnedRow = { ...sampleRecord(), id: '42', created_at: '2026-01-01T00:00:00Z' };
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [returnedRow] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    const record = sampleRecord();
    const result = await adapter.insert(record);

    check('5. Successful insert returns the inserted row', result.id === '42' && result.created_at === '2026-01-01T00:00:00Z');
    check('5b. Exactly one fetch call made', fake.getCallCount() === 1);

    const call = fake.getCalls()[0];
    check('5c. Correct endpoint constructed (URL + /rest/v1/Tenders)', call.url === FAKE_URL + '/rest/v1/Tenders');
    check('5d. Method is POST', call.opts.method === 'POST');
    check('5e. apikey header set to the key from env', call.opts.headers.apikey === FAKE_KEY);
    check('5f. Authorization header is "Bearer " + key', call.opts.headers.Authorization === 'Bearer ' + FAKE_KEY);
    check('5g. Prefer header requests representation (returns generated row)', call.opts.headers.Prefer === 'return=representation');
    check('5h. Record sent as-is, unmodified', call.opts.body === JSON.stringify(record));
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL + '/'; // trailing slash — must not produce a double slash
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{ id: '1' }] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    await adapter.insert(sampleRecord());

    check('6. Trailing slash in SUPABASE_URL handled correctly (no double slash)', fake.getCalls()[0].url === FAKE_URL + '/rest/v1/Tenders');
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [{ id: '1' }] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter({ tableName: 'CustomTable' });
    await adapter.insert(sampleRecord());

    check('7. Custom tableName option respected', fake.getCalls()[0].url === FAKE_URL + '/rest/v1/CustomTable');
  })();

  console.log('');
  console.log('=== ERROR HANDLING ===');

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({
      ok: false, status: 409,
      json: async () => ({ message: 'duplicate key value violates unique constraint', code: '23505' })
    }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('8. PostgREST error response -> throws with message + code', threw &&
      message.includes('duplicate key value violates unique constraint') && message.includes('23505'));
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => { throw new Error('ECONNREFUSED fake network failure'); });
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('9. Network-level failure -> throws a generic message', threw && message.includes('network error'));
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => { throw new Error('unexpected token'); } }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('10. Malformed JSON response -> throws a clear, generic message', threw && message.includes('could not parse'));
  })();

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const fake = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [] }));
    global.fetch = fake;

    const adapter = createSupabaseAdapter();
    let threw = false;
    let message = '';
    try {
      await adapter.insert(sampleRecord());
    } catch (e) {
      threw = true;
      message = e.message;
    }
    check('11. Empty array response (no row returned) -> throws clearly', threw && message.includes('no row was returned'));
  })();

  console.log('');
  console.log('=== CREDENTIAL HYGIENE ===');

  await withFakeEnv(async () => {
    process.env.SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
    const scenarios = [
      async () => { global.fetch = fakeFetch(async () => { throw new Error('boom'); }); return createSupabaseAdapter().insert(sampleRecord()); },
      async () => { global.fetch = fakeFetch(async () => ({ ok: false, status: 500, json: async () => ({ message: 'server error', code: 'XX000' }) })); return createSupabaseAdapter().insert(sampleRecord()); },
      async () => { global.fetch = fakeFetch(async () => ({ ok: true, status: 201, json: async () => [] })); return createSupabaseAdapter().insert(sampleRecord()); }
    ];

    let allClean = true;
    for (const scenario of scenarios) {
      try {
        await scenario();
      } catch (e) {
        if (e.message.includes(FAKE_KEY) || e.message.includes(FAKE_URL)) {
          allClean = false;
        }
      }
    }
    check('12. No thrown error message ever contains the key or URL', allClean);
  })();

  console.log('');
  console.log('=== SOURCE-CODE CREDENTIAL HYGIENE (structural check) ===');

  const adapterSource = fs.readFileSync(path.join(__dirname, 'supabase-adapter.js'), 'utf8');

  check('13a. References process.env.SUPABASE_URL (reads from env, as required)', adapterSource.includes('process.env[varName]') && adapterSource.includes("'SUPABASE_URL'"));
  check('13b. References process.env.SUPABASE_SERVICE_ROLE_KEY (reads from env, as required)', adapterSource.includes("'SUPABASE_SERVICE_ROLE_KEY'"));
  check('13c. No hardcoded fallback alongside the env reads (no "||" default value pattern)', !/readRequiredEnv\([^)]*\)\s*\|\|/.test(adapterSource));
  check('13d. No literal "supabase.co" URL hardcoded anywhere', !/https?:\/\/[a-z0-9-]+\.supabase\.co/i.test(adapterSource.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('13e. No literal JWT-like or "sb_"-prefixed key hardcoded anywhere', !/eyJ[a-zA-Z0-9_-]{10,}/.test(adapterSource) && !/sb_[a-zA-Z0-9_-]{10,}/.test(adapterSource));

  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Passed: ' + pass);
  console.log('Failed: ' + fail);

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main();
