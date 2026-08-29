/**
 * TenderAlert — Final Validation Test Suite
 * Local/synthetic only. Does NOT touch Supabase, the dashboard, or any live source.
 */

'use strict';

const { finalValidate } = require('./final-validation');

let pass = 0;
let fail = 0;

function run(label, input, expectedStatus, extraCheck) {
  const result = finalValidate(input);
  let ok = result.status === expectedStatus;
  if (ok && extraCheck) ok = extraCheck(result);

  ok ? pass++ : fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + ' -> ' + result.status + (ok ? '' : ' (expected ' + expectedStatus + ')'));
  console.log('        reasons: ' + JSON.stringify(result.reasons));
  return result;
}

/* ============================================================
   BASELINE — a fully clean, fully-passing candidate
   ============================================================ */

function baseline() {
  const sourceFacts = {
    title: 'Construction of District Roads',
    sector: 'Construction',
    organization: 'Ministry of Works',
    location: 'Kampala',
    deadline: '2027-09-28',
    reference: 'PPDA/DEMO/2026/001'
  };

  return {
    sourceFacts,
    validationResult: { status: 'VALID' },
    dedupResult: { status: 'NEW' },
    aiResult: { status: 'ACCEPTED' },
    dedupOverrideApproved: false,
    assembledRecord: {
      Title: sourceFacts.title,
      Sector: sourceFacts.sector,
      Organization: sourceFacts.organization,
      Location: sourceFacts.location,
      deadline: sourceFacts.deadline,
      reference: sourceFacts.reference,
      match_percentage: null,
      summary: 'A sample plain-language summary.',
      buyer_wants: 'A sample description of what the buyer wants.',
      eligibility: 'A sample eligibility statement.',
      requirements: ['Requirement A', 'Requirement B'],
      documents: ['Document A']
    }
  };
}

// Deep-ish clone helper for mutating one field per test without cross-contamination.
function clone(input) {
  return JSON.parse(JSON.stringify(input));
}

console.log('=== BASELINE ===');
run('1. Completely valid assembled record', baseline(), 'READY_FOR_INSERTION');

console.log('');
console.log('=== PIPELINE-STAGE CONSISTENCY -> HOLD_FOR_REVIEW ===');

let t = clone(baseline());
t.dedupResult = { status: 'POSSIBLE_DUPLICATE' };
run('2. POSSIBLE_DUPLICATE dedup result', t, 'HOLD_FOR_REVIEW');

t = clone(baseline());
t.dedupResult = { status: 'REVIEW' };
run('3. REVIEW dedup result', t, 'HOLD_FOR_REVIEW');

t = clone(baseline());
t.aiResult = { status: 'REVIEW' };
run('4. Non-ACCEPTED AI result (REVIEW)', t, 'HOLD_FOR_REVIEW');

t = clone(baseline());
t.aiResult = { status: 'REJECTED' };
run('4b. Non-ACCEPTED AI result (REJECTED)', t, 'HOLD_FOR_REVIEW');

t = clone(baseline());
t.validationResult = { status: 'REVIEW' };
run('4c. Non-VALID validation result (defensive — should never normally arrive here)', t, 'HOLD_FOR_REVIEW');

console.log('');
console.log('=== IMMUTABLE FACT INTEGRITY -> REJECTED ===');

t = clone(baseline());
t.assembledRecord.Title = 'A Completely Different Title';
run('5. Title integrity mismatch', t, 'REJECTED', r => r.reasons.join(' | ').includes('Title integrity mismatch'));

t = clone(baseline());
t.assembledRecord.Sector = 'Supplies';
run('6. Sector integrity mismatch', t, 'REJECTED', r => r.reasons.join(' | ').includes('Sector integrity mismatch'));

t = clone(baseline());
t.assembledRecord.Organization = 'A Different Organization';
run('7. Organization integrity mismatch', t, 'REJECTED', r => r.reasons.join(' | ').includes('Organization integrity mismatch'));

t = clone(baseline());
t.assembledRecord.deadline = '2028-01-01';
run('8. Deadline integrity mismatch', t, 'REJECTED', r => r.reasons.join(' | ').includes('Deadline integrity mismatch'));

t = clone(baseline());
t.assembledRecord.reference = 'PPDA/DEMO/2026/999';
run('9. Reference integrity mismatch', t, 'REJECTED', r => r.reasons.join(' | ').includes('Reference integrity mismatch'));

console.log('');
console.log('=== SCHEMA / TYPE CONFORMANCE -> REJECTED ===');

t = clone(baseline());
t.assembledRecord.requirements = 'not an array, just a string';
run('10. Invalid requirements type (string instead of array)', t, 'REJECTED', r => r.reasons.join(' | ').includes('"requirements" must be an array of strings'));

t = clone(baseline());
t.assembledRecord.documents = 12345;
run('11. Invalid documents type (number instead of array)', t, 'REJECTED', r => r.reasons.join(' | ').includes('"documents" must be an array of strings'));

t = clone(baseline());
t.sourceFacts.organization = '';
t.assembledRecord.Organization = '';
run('12. Missing required field (Organization blank in both source and assembled)', t, 'REJECTED', r => r.reasons.join(' | ').includes('Required field "Organization" is missing or blank'));

t = clone(baseline());
t.assembledRecord.match_percentage = 87;
run('13. Non-null match_percentage', t, 'REJECTED', r => r.reasons.join(' | ').includes('match_percentage must be null/absent'));

t = clone(baseline());
t.assembledRecord.summary = 12345;
run('14. Invalid AI-generated field type (summary as number)', t, 'REJECTED', r => r.reasons.join(' | ').includes('"summary" must be a string'));

console.log('');
console.log('=== NULLABLE FIELDS ABSENT -> STILL READY ===');

t = clone(baseline());
t.sourceFacts.location = null;
t.assembledRecord.Location = null;
t.sourceFacts.reference = null;
t.assembledRecord.reference = null;
delete t.assembledRecord.summary;
delete t.assembledRecord.buyer_wants;
delete t.assembledRecord.eligibility;
delete t.assembledRecord.requirements;
delete t.assembledRecord.documents;
run('15. All permitted-nullable fields absent', t, 'READY_FOR_INSERTION');

console.log('');
console.log('=== OVERRIDE HANDLING ===');

t = clone(baseline());
t.dedupResult = { status: 'POSSIBLE_DUPLICATE' };
t.dedupOverrideApproved = true;
run('15b. POSSIBLE_DUPLICATE with explicit approved override -> still READY, override noted', t, 'READY_FOR_INSERTION', r => r.reasons.join(' | ').includes('explicitly approved override'));

console.log('');
console.log('=== REAL TEST TENDER KNOWN FACTS ===');
console.log('NOTE: Sector=Construction and Location=Kampala reuse the facts already');
console.log('confirmed for the real test tender in earlier stages. Other fields are');
console.log('placeholders, consistent with prior isolated tests in this project.');
console.log('');

t = clone(baseline()); // baseline already uses Construction/Kampala
run('16. Real test tender known facts (Construction/Kampala) pass', t, 'READY_FOR_INSERTION');

console.log('');
console.log('=== EDGE CASES ADDED FOLLOWING THE INTEGRATION AUDIT ===');

// 17. Combined REJECTED-level + HOLD-level problem in the same record.
// The architecture's existing rule (REJECTED checks run first, and any
// REJECTED-level finding wins over a HOLD-level one) must still hold, and
// BOTH concerns must still be visible in the reasons — nothing hidden just
// because the more severe one took over the final status.
t = clone(baseline());
t.dedupResult = { status: 'POSSIBLE_DUPLICATE' }; // HOLD-level concern
t.assembledRecord.Title = 'A Completely Different Title'; // REJECTED-level concern
run('17. Combined REJECTED + HOLD-level issue -> REJECTED wins, both reasons surfaced', t, 'REJECTED',
  r => r.reasons.join(' | ').includes('Title integrity mismatch') &&
       r.reasons.join(' | ').includes('POSSIBLE_DUPLICATE'));

// 18. sourceFacts completely absent. Every fact-integrity comparison should
// fail safe (assembled values with nothing to compare against = mismatch),
// never silently pass through as READY.
t = clone(baseline());
delete t.sourceFacts;
run('18. sourceFacts completely absent -> safe, never READY', t, 'REJECTED',
  r => r.status !== 'READY_FOR_INSERTION' && r.reasons.length > 0);

// 19. assembledRecord completely absent. Same principle in the other
// direction — nothing to check against real values means fail safe, not
// fail open.
t = clone(baseline());
delete t.assembledRecord;
run('19. assembledRecord completely absent -> safe, never READY', t, 'REJECTED',
  r => r.status !== 'READY_FOR_INSERTION' && r.reasons.length > 0);

// 20. Uganda/EAT deadline handling must remain the Validation stage's
// responsibility, not duplicated or contradicted here. An expired-but-valid
// deadline (already accepted upstream as VALID, per validation.js's own
// EAT-aware expiry rule) must still reach READY_FOR_INSERTION — Final
// Validation only confirms the date is syntactically valid and matches the
// source; it must never independently re-judge "is this expired".
t = clone(baseline());
t.sourceFacts.deadline = '2020-01-01'; // clearly in the past
t.assembledRecord.deadline = '2020-01-01'; // matches; validation.js already accepted this upstream
run('20. Expired-but-valid deadline still reaches READY (EAT expiry logic not duplicated here)', t, 'READY_FOR_INSERTION');

console.log('');
console.log('=== NOTHING SILENTLY DISCARDED — every non-ready result has reasons ===');

const holdCheck = finalValidate({ ...clone(baseline()), dedupResult: { status: 'REVIEW' } });
const holdHasReasons = Array.isArray(holdCheck.reasons) && holdCheck.reasons.length > 0;
holdHasReasons ? pass++ : fail++;
console.log((holdHasReasons ? '  PASS ' : '  FAIL ') + '21. HOLD_FOR_REVIEW result always includes reasons');

const rejectCheck = finalValidate({ ...clone(baseline()), assembledRecord: { ...clone(baseline()).assembledRecord, Title: 'Different' } });
const rejectHasReasons = Array.isArray(rejectCheck.reasons) && rejectCheck.reasons.length > 0;
rejectHasReasons ? pass++ : fail++;
console.log((rejectHasReasons ? '  PASS ' : '  FAIL ') + '22. REJECTED result always includes reasons');

console.log('');
console.log('=== SUMMARY ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) {
  process.exitCode = 1;
}
