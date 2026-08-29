/**
 * TenderAlert — Insertion Executor Test Suite
 * Local/synthetic only. Uses the mock Supabase adapter exclusively.
 * No network calls, no real Supabase, no credentials.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { executeInsertion } = require('./insertion-executor');
const { createMockSupabaseAdapter } = require('./mock-supabase-adapter');

let pass = 0;
let fail = 0;

async function run(label, input, expectedStatus, extraCheck) {
  const result = await executeInsertion(input);
  let ok = result.status === expectedStatus;
  if (ok && extraCheck) ok = extraCheck(result);

  ok ? pass++ : fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + ' -> ' + result.status + (ok ? '' : ' (expected ' + expectedStatus + ')'));
  console.log('        reasons: ' + JSON.stringify(result.reasons));
  return result;
}

function baselineSourceFacts() {
  return {
    title: 'Construction of District Roads',
    sector: 'Construction',
    organization: 'Ministry of Works',
    location: 'Kampala',
    deadline: '2027-09-28',
    reference: 'PPDA/DEMO/2026/001'
  };
}

function baselineAssembledRecord() {
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
    requirements: ['Requirement A'],
    documents: ['Document A']
  };
}

async function main() {
  console.log('=== INSERTION EXECUTOR TESTS ===');

  // 1. READY_FOR_INSERTION -> mock INSERT called once
  {
    const adapter = createMockSupabaseAdapter();
    const result = await run('1. READY_FOR_INSERTION -> inserted', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'INSERTED');
    const onceOk = adapter.getAttemptCount() === 1;
    onceOk ? pass++ : fail++;
    console.log((onceOk ? '  PASS ' : '  FAIL ') + '1b. Exactly one insertion attempt was made (actual: ' + adapter.getAttemptCount() + ')');
  }

  // 2. HOLD_FOR_REVIEW -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    await run('2. HOLD_FOR_REVIEW -> no insertion attempted', {
      finalValidationResult: { status: 'HOLD_FOR_REVIEW', reasons: ['some hold reason'] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED');
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log((zeroOk ? '  PASS ' : '  FAIL ') + '2b. Zero insertion attempts (actual: ' + adapter.getAttemptCount() + ')');
  }

  // 3. REJECTED -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    await run('3. REJECTED final-validation status -> no insertion attempted', {
      finalValidationResult: { status: 'REJECTED', reasons: ['some reject reason'] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED');
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log((zeroOk ? '  PASS ' : '  FAIL ') + '3b. Zero insertion attempts (actual: ' + adapter.getAttemptCount() + ')');
  }

  // 4. Duplicate/unsafe result (a dedup-style status somehow passed as finalValidationResult.status) -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    await run('4. Non-READY status (e.g. "DUPLICATE") -> no insertion attempted', {
      finalValidationResult: { status: 'DUPLICATE', reasons: ['should never reach this stage, defensive check'] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED');
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log((zeroOk ? '  PASS ' : '  FAIL ') + '4b. Zero insertion attempts (actual: ' + adapter.getAttemptCount() + ')');
  }

  // 5-8. Missing required fields -> no insertion
  for (const field of ['Title', 'Sector', 'Organization', 'deadline']) {
    const adapter = createMockSupabaseAdapter();
    const record = baselineAssembledRecord();
    record[field] = '';
    await run('5-8. Missing required field "' + field + '" -> no insertion', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: record,
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED', r => r.reasons.join(' | ').includes('"' + field + '"'));
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log('        zero insertion attempts: ' + (zeroOk ? 'PASS' : 'FAIL'));
  }

  // 9. Non-null match_percentage -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    const record = baselineAssembledRecord();
    record.match_percentage = 87;
    await run('9. Non-null match_percentage -> no insertion', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: record,
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED', r => r.reasons.join(' | ').includes('match_percentage'));
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log('        zero insertion attempts: ' + (zeroOk ? 'PASS' : 'FAIL'));
  }

  // 10. Immutable field mutation (Title changed after the fact) -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    const record = baselineAssembledRecord();
    record.Title = 'A Tampered Title Nobody Approved';
    await run('10. Immutable field (Title) mutated -> no insertion', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: record,
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED', r => r.reasons.join(' | ').includes('Title no longer matches confirmed source facts'));
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log('        zero insertion attempts: ' + (zeroOk ? 'PASS' : 'FAIL'));
  }

  // 11. Wrong requirements type -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    const record = baselineAssembledRecord();
    record.requirements = 'not an array';
    await run('11. Wrong requirements type -> no insertion', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: record,
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED', r => r.reasons.join(' | ').includes('"requirements"'));
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log('        zero insertion attempts: ' + (zeroOk ? 'PASS' : 'FAIL'));
  }

  // 12. Wrong documents type -> no insertion
  {
    const adapter = createMockSupabaseAdapter();
    const record = baselineAssembledRecord();
    record.documents = 12345;
    await run('12. Wrong documents type -> no insertion', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: record,
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'REJECTED', r => r.reasons.join(' | ').includes('"documents"'));
    const zeroOk = adapter.getAttemptCount() === 0;
    zeroOk ? pass++ : fail++;
    console.log('        zero insertion attempts: ' + (zeroOk ? 'PASS' : 'FAIL'));
  }

  // 13. Mock database failure -> FAILED
  {
    const adapter = createMockSupabaseAdapter({ simulateFailure: true, failureMessage: 'simulated connection timeout' });
    await run('13. Mock database failure -> FAILED', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'FAILED', r => r.reasons.join(' | ').includes('simulated connection timeout'));
  }

  // 14. Successful mock insertion -> INSERTED, with the returned record intact
  {
    const adapter = createMockSupabaseAdapter();
    await run('14. Successful mock insertion -> INSERTED with correct record shape', {
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    }, 'INSERTED', r => r.record.Title === 'Construction of District Roads' && r.record.match_percentage === null && typeof r.record.id === 'string');
  }

  // 15. Verify the executor never exposes credentials — structural source-code check,
  // plus confirm no adapter/env-var-style fields ever appear in a returned result.
  console.log('');
  console.log('=== CREDENTIAL HYGIENE CHECK ===');
  const executorSource = fs.readFileSync(path.join(__dirname, 'insertion-executor.js'), 'utf8');
  const adapterSource = fs.readFileSync(path.join(__dirname, 'mock-supabase-adapter.js'), 'utf8');
  const suspiciousPatterns = [/process\.env/i, /service_role/i, /api[_-]?key/i, /secret/i, /supabase\.co/i, /Authorization/i];

  const executorClean = !suspiciousPatterns.some(p => p.test(executorSource));
  executorClean ? pass++ : fail++;
  console.log((executorClean ? '  PASS ' : '  FAIL ') + '15a. insertion-executor.js contains no credential-like patterns');

  const adapterClean = !suspiciousPatterns.some(p => p.test(adapterSource));
  adapterClean ? pass++ : fail++;
  console.log((adapterClean ? '  PASS ' : '  FAIL ') + '15b. mock-supabase-adapter.js contains no credential-like patterns');

  {
    const adapter = createMockSupabaseAdapter({ simulateFailure: true, failureMessage: 'simulated connection timeout for hygiene check' });
    const failResult = await executeInsertion({
      finalValidationResult: { status: 'READY_FOR_INSERTION', reasons: [] },
      assembledRecord: baselineAssembledRecord(),
      sourceFacts: baselineSourceFacts(),
      adapter
    });
    const errorTextClean = !suspiciousPatterns.some(p => p.test(JSON.stringify(failResult)));
    errorTextClean ? pass++ : fail++;
    console.log((errorTextClean ? '  PASS ' : '  FAIL ') + '15c. A FAILED result never contains credential-like content');
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Passed: ' + pass);
  console.log('Failed: ' + fail);

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main();
