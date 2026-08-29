/**
 * TenderAlert — Validation Test Suite
 * Local/synthetic only. Does NOT touch Supabase, the dashboard, or any live source.
 */

'use strict';

const { validateTender, ugandaNowDateOnly } = require('./validation');

let pass = 0;
let fail = 0;

function run(label, tender, expectedStatus, extraCheck) {
  const result = validateTender(tender);
  let ok = result.status === expectedStatus;
  if (ok && extraCheck) ok = extraCheck(result);

  ok ? pass++ : fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + ' -> ' + result.status + (ok ? '' : ' (expected ' + expectedStatus + ')'));
  if (result.reasons.length > 0) {
    result.reasons.forEach(r => console.log('        ' + r));
  }
  return result;
}

console.log('Reference point — Uganda "today" for this run: ' + ugandaNowDateOnly());
console.log('');

/* ============================================================
   VALID RECORDS
   ============================================================ */
console.log('=== VALID RECORDS ===');

// 1. Fully valid tender
run('1. Fully valid tender', {
  title: 'Construction of District Roads',
  sector: 'Construction',
  organization: 'Local Government Authority',
  location: 'Kampala',
  deadline: '2027-09-28',
  reference: 'PPDA/DEMO/2026/001',
  match_percentage: 92,
  summary: 'A sample tender summary.',
  buyer_wants: 'A qualified contractor.',
  eligibility: 'Registered construction firms.',
  requirements: ['Valid registration', 'Tax clearance'],
  documents: ['Certificate of incorporation']
}, 'VALID');

// 2. Valid tender without reference
run('2. Valid tender without reference', {
  title: 'Supply of Office Furniture',
  sector: 'Supplies',
  organization: 'District Local Government',
  location: 'Jinja',
  deadline: '2027-10-05',
  reference: ''
}, 'VALID');

// 3. Valid tender without location
run('3. Valid tender without location', {
  title: 'ICT Infrastructure Support',
  sector: 'IT',
  organization: 'Government Agency',
  deadline: '2027-10-16',
  reference: 'PPDA/DEMO/2026/003'
}, 'VALID');

// 4. Valid tender without summary/AI fields
run('4. Valid tender without AI-generated fields', {
  title: 'Consultancy Services for Institutional Review',
  sector: 'Consultancy',
  organization: 'Ministry Department',
  location: 'Mbarara',
  deadline: '2027-09-05',
  reference: 'PPDA/DEMO/2026/004'
  // summary, buyer_wants, eligibility, requirements, documents all omitted
}, 'VALID');

/* ============================================================
   INVALID RECORDS
   ============================================================ */
console.log('');
console.log('=== INVALID RECORDS ===');

// 5. Missing title
run('5. Missing title', {
  sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'INVALID');

// 6. Empty title
run('6. Empty title', {
  title: '   ', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'INVALID');

// 7. Missing sector -> REVIEW (corrected: needs manual classification, not outright rejection)
// (moved to Review/Warning section below)

// 8. Unknown sector -> REVIEW (corrected: needs manual classification, not outright rejection)
// (moved to Review/Warning section below)

// 9. Missing organization
run('9. Missing organization', {
  title: 'Some Tender', sector: 'Construction', deadline: '2027-09-28'
}, 'INVALID');

// 10. Empty organization
run('10. Empty organization', {
  title: 'Some Tender', sector: 'Construction', organization: '   ', deadline: '2027-09-28'
}, 'INVALID');

// 11. Missing deadline
run('11. Missing deadline', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works'
}, 'INVALID');

// 12. Invalid deadline (unparseable format)
run('12. Invalid deadline format', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '28th September 2027'
}, 'INVALID');

// 13. Impossible date (Feb 30)
run('13. Impossible date (Feb 30)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-02-30'
}, 'INVALID');

// 14. Invalid match_percentage when supplied
run('14. Invalid match_percentage (out of range)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  match_percentage: 150
}, 'INVALID');

run('14b. Invalid match_percentage (non-numeric)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  match_percentage: 'high'
}, 'INVALID');

// 15. Invalid requirements/documents structure when supplied
run('15. Invalid requirements structure (a number)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  requirements: 12345
}, 'INVALID');

run('15b. Invalid documents structure (array of non-strings)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  documents: [{ file: 'not-a-string' }]
}, 'INVALID');

/* ============================================================
   REVIEW / WARNING CASES
   ============================================================ */
console.log('');
console.log('=== REVIEW / WARNING CASES ===');

// 7. Missing sector -> REVIEW
run('7. Missing sector', {
  title: 'Some Tender', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'REVIEW');

// 8. Unknown sector -> REVIEW
run('8. Unknown sector', {
  title: 'Some Tender', sector: 'Environmental Services', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'REVIEW');

// 8b. Valid normalized sector -> VALID (control case, confirms the six-sector list still passes cleanly)
run('8b. Valid normalized sector (Construction)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'VALID');

// 16. Expired tender -> should PASS validation (VALID), marked expired via flag
run('16. Expired tender (deadline in the past)', {
  title: 'Old Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2020-01-01'
}, 'VALID', result => result.isExpired === true);

// 17. Ambiguous optional data (meaningless reference) -> REVIEW
run('17. Ambiguous optional data (symbols-only reference)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  reference: '###'
}, 'REVIEW');

// 18. Reference with unusual but potentially valid formatting -> VALID with warning
run('18. Unusual but plausible reference format', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  reference: 'REF#2026/XYZ-99!'
}, 'VALID', result => result.fields.reference.severity === 'WARNING');

// 19. Missing optional AI-generated fields -> VALID
run('19. Missing optional AI-generated fields', {
  title: 'Some Tender', sector: 'Medical', organization: 'Regional Hospital', deadline: '2027-11-02'
  // summary, buyer_wants, eligibility, requirements, documents all omitted
}, 'VALID');

/* ============================================================
   ADDITIONAL ROBUSTNESS TESTS
   ============================================================ */
console.log('');
console.log('=== ADDITIONAL ROBUSTNESS TESTS ===');

run('Placeholder title ("TBD")', {
  title: 'TBD', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28'
}, 'REVIEW');

run('Placeholder organization ("N/A")', {
  title: 'Some Tender', sector: 'Construction', organization: 'N/A', deadline: '2027-09-28'
}, 'REVIEW');

run('Deadline unusually far in the future (still valid, warned)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2032-01-01'
}, 'VALID', result => result.fields.deadline.severity === 'WARNING');

run('Deadline year out of plausible range (1200)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '1200-01-01'
}, 'INVALID');

run('Deadline with full ISO datetime + timezone', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28T17:00:00+03:00'
}, 'VALID');

run('Meaningless location (symbols only)', {
  title: 'Some Tender', sector: 'Construction', organization: 'Ministry of Works', deadline: '2027-09-28',
  location: '###'
}, 'REVIEW');

run('Empty/invalid record (everything missing)', {}, 'INVALID');

/* ============================================================
   REAL TENDERALERT TEST TENDER (baseline)
   ============================================================ */
console.log('');
console.log('=== BASELINE: REAL TENDERALERT TEST TENDER ===');
console.log('NOTE: This sandbox has no live network access to Supabase, so the exact');
console.log('Title/Organization/deadline/reference of the real inserted test row could');
console.log('not be pulled directly. The values below reuse the Sector=Construction,');
console.log('Location=Kampala facts already confirmed in earlier steps, with placeholder');
console.log('Title/Organization/deadline/reference matching the demo pattern used so far.');
console.log('Recommend verifying against the actual row in Supabase before relying on this.');
console.log('');

run('Real test tender (placeholder values)', {
  title: 'Construction of District Roads',
  sector: 'Construction',
  organization: 'Local Government Authority',
  location: 'Kampala',
  deadline: '2027-09-28',
  reference: 'PPDA/DEMO/2026/001'
}, 'VALID');

console.log('');
console.log('=== SUMMARY ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) {
  process.exitCode = 1;
}
