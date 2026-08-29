/**
 * TenderAlert — Deduplication Test Suite
 * Local/synthetic only. Does NOT touch Supabase, the dashboard, or any live source.
 */

'use strict';

const { checkDuplicate } = require('./dedup');

let pass = 0;
let fail = 0;

function run(label, incoming, existing, expectedStatus) {
  const result = checkDuplicate(incoming, existing);
  const ok = result.status === expectedStatus;
  ok ? pass++ : fail++;
  console.log(
    (ok ? '  PASS ' : '  FAIL ') + label +
    ' -> ' + result.status +
    (ok ? '' : ' (expected ' + expectedStatus + ')')
  );
  console.log('        reasons: ' + JSON.stringify(result.reasons));
  return result;
}

/* ============================================================
   Baseline "database" of existing records used across tests
   ============================================================ */

const existingRecords = [
  {
    id: 'existing-1',
    title: 'Road Construction Works',
    organization: 'Ministry of Works',
    deadline: '2026-09-28',
    reference: 'PPDA/DEMO/2026/001'
  },
  {
    id: 'existing-2',
    title: 'Supply of Office Furniture',
    organization: 'District Local Government',
    deadline: '2026-10-05',
    reference: 'PPDA/DEMO/2026/002'
  },
  {
    id: 'existing-3',
    title: 'Rehabilitation of Health Centre',
    organization: 'Ministry of Health',
    deadline: '2026-11-01',
    reference: '' // no reference on this record
  }
];

console.log('=== REQUIRED EDGE CASE TESTS ===');

// 1. Exact same reference -> DUPLICATE
run(
  '1. Exact same reference',
  { title: 'Road Construction Works', organization: 'Ministry of Works', deadline: '2026-09-28', reference: 'PPDA/DEMO/2026/001' },
  existingRecords,
  'DUPLICATE'
);

// 2. Same reference, different capitalization/spacing -> DUPLICATE
run(
  '2. Same reference, different formatting',
  { title: 'Road Construction Works', organization: 'Ministry of Works', deadline: '2026-09-28', reference: ' ppda / demo / 2026 / 001 ' },
  existingRecords,
  'DUPLICATE'
);

// 3. Same title+org+deadline with formatting differences (no reference) -> DUPLICATE
run(
  '3. Same title/org/deadline, formatting differences, no reference',
  { title: '  ROAD   construction Works  ', organization: 'ministry of works', deadline: '2026-09-28', reference: '' },
  existingRecords,
  'DUPLICATE'
);

// 4. Different reference (everything else different too) -> NEW
run(
  '4. Different reference, different everything',
  { title: 'Supply of Laboratory Equipment', organization: 'Regional Hospital', deadline: '2027-01-15', reference: 'PPDA/DEMO/2027/099' },
  existingRecords,
  'NEW'
);

// 5. Different deadline only -> NEW (no other strong duplicate signal)
run(
  '5. Same title/org, different deadline, no reference',
  { title: 'Road Construction Works', organization: 'Ministry of Works', deadline: '2026-12-01', reference: '' },
  existingRecords,
  'NEW'
);

// 6. Same title, different organization -> NEW
run(
  '6. Same title, different organization',
  { title: 'Road Construction Works', organization: 'City Authority', deadline: '2026-09-28', reference: '' },
  existingRecords,
  'NEW'
);

// 7. Same organization, clearly different title -> NEW
run(
  '7. Same organization, different title',
  { title: 'Supply of Office Stationery', organization: 'Ministry of Works', deadline: '2026-09-28', reference: '' },
  existingRecords,
  'NEW'
);

// 8. Missing reference -> fallback fingerprint used (duplicate found via fingerprint)
run(
  '8. Missing reference, fingerprint fallback catches duplicate',
  { title: 'Supply of Office Furniture', organization: 'District Local Government', deadline: '2026-10-05', reference: '' },
  existingRecords,
  'DUPLICATE'
);

// 9. Missing title -> REVIEW
run(
  '9. Missing title',
  { title: '', organization: 'Ministry of Works', deadline: '2026-09-28', reference: 'PPDA/DEMO/2026/777' },
  existingRecords,
  'REVIEW'
);

// 10. Missing organization -> REVIEW
run(
  '10. Missing organization',
  { title: 'Some New Tender', organization: '', deadline: '2026-09-28', reference: 'PPDA/DEMO/2026/778' },
  existingRecords,
  'REVIEW'
);

// 11. Missing deadline -> REVIEW
run(
  '11. Missing deadline',
  { title: 'Some New Tender', organization: 'Ministry of Works', deadline: '', reference: 'PPDA/DEMO/2026/779' },
  existingRecords,
  'REVIEW'
);

// 12. Slight title wording variation, same org/deadline -> POSSIBLE_DUPLICATE
run(
  '12. Slight title wording variation, same org/deadline',
  { title: 'Road Construction Work', organization: 'Ministry of Works', deadline: '2026-09-28', reference: '' }, // "Work" vs "Works"
  existingRecords,
  'POSSIBLE_DUPLICATE'
);

// 13. Conflicting references (same reference, different title/org/deadline) -> REVIEW
run(
  '13. Conflicting reference (same ref number, different details)',
  { title: 'Totally Different Tender', organization: 'Different Organization', deadline: '2028-01-01', reference: 'PPDA/DEMO/2026/001' },
  existingRecords,
  'REVIEW'
);

// 14. Empty/invalid record -> REVIEW
run(
  '14. Empty/invalid record',
  { title: '', organization: '', deadline: '', reference: '' },
  existingRecords,
  'REVIEW'
);

console.log('');
console.log('=== ADDITIONAL FINGERPRINT / REFERENCE ROBUSTNESS TESTS ===');

// Fingerprint match where one side has a reference and the other doesn't -> DUPLICATE
run(
  'Fingerprint match, existing has no reference, incoming has none either',
  { title: 'Rehabilitation of Health Centre', organization: 'Ministry of Health', deadline: '2026-11-01', reference: '' },
  existingRecords,
  'DUPLICATE'
);

// Same fingerprint, but BOTH sides have different reference numbers -> POSSIBLE_DUPLICATE
run(
  'Same fingerprint, different reference numbers on both sides',
  { title: 'Road Construction Works', organization: 'Ministry of Works', deadline: '2026-09-28', reference: 'PPDA/DEMO/2026/999' },
  existingRecords,
  'POSSIBLE_DUPLICATE'
);

console.log('');
console.log('=== BASELINE: REAL TENDERALERT TEST TENDER ===');
console.log('NOTE: This sandbox has no live network access to Supabase, so the exact');
console.log('Title/Organization/deadline/reference of the real inserted test row could');
console.log('not be pulled directly. The values below reuse the Sector=Construction,');
console.log('Location=Kampala facts already confirmed in the normalization step, with');
console.log('placeholder Title/Organization/deadline/reference for this isolated test.');
console.log('Recommend verifying against the actual row in Supabase before relying on this.');
console.log('');

const realTenderBaseline = {
  title: 'Construction of District Roads', // placeholder, matches earlier demo data pattern
  organization: 'Local Government Authority', // placeholder
  deadline: '2026-09-28', // placeholder
  reference: 'PPDA/DEMO/2026/001' // placeholder
};

run(
  'Real test tender (placeholder values) vs itself re-submitted',
  realTenderBaseline,
  [{ id: 'real-test-tender', ...realTenderBaseline }],
  'DUPLICATE'
);

run(
  'Real test tender (placeholder values) as first-ever record',
  realTenderBaseline,
  [],
  'NEW'
);

console.log('');
console.log('=== SUMMARY ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) {
  process.exitCode = 1;
}
