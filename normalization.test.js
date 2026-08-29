/**
 * TenderAlert — Normalization Test Suite
 * Local/synthetic only. Does NOT touch Supabase, the dashboard, or any live source.
 */

'use strict';

const { normalizeSector, normalizeLocation, normalizeTenderFields } = require('./normalization');

let pass = 0;
let fail = 0;

function checkSector(input, expected, note) {
  const result = normalizeSector(input);
  const actual = result.manualReviewRequired ? 'MANUAL REVIEW' : result.normalized;
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(
    (ok ? '  PASS ' : '  FAIL ') +
    JSON.stringify(input) + ' -> ' + actual +
    (ok ? '' : ' (expected ' + expected + ')') +
    (note ? '   [' + note + ']' : '') +
    (result.manualReviewRequired ? '   reason: ' + result.reason : '')
  );
}

function checkLocation(input, expected, note) {
  const result = normalizeLocation(input);
  let actual;
  if (result.manualReviewRequired) actual = 'MANUAL REVIEW';
  else if (result.normalized === null) actual = 'BLANK/NULL';
  else actual = result.normalized;

  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(
    (ok ? '  PASS ' : '  FAIL ') +
    JSON.stringify(input) + ' -> ' + actual +
    (ok ? '' : ' (expected ' + expected + ')') +
    (note ? '   [' + note + ']' : '') +
    (result.manualReviewRequired ? '   reason: ' + result.reason : '')
  );
}

console.log('=== SECTOR NORMALIZATION TESTS ===');

// Required minimum test cases
checkSector('Building & Civil Works', 'Construction');
checkSector('ICT / Information Technology Services', 'IT');
checkSector('Supply of Medical Equipment', 'Medical');
checkSector('General Office Supplies', 'Supplies');
checkSector('Consultancy Services for Institutional Review', 'Consultancy');
checkSector('Agricultural Inputs', 'Agriculture');
checkSector('Health Supplies', 'Medical');
checkSector('Agricultural Supplies', 'Agriculture');
checkSector('Environmental Services', 'MANUAL REVIEW');
checkSector('Mixed Works & Supplies', 'MANUAL REVIEW');
checkSector('', 'MANUAL REVIEW');

console.log('');
console.log('--- Additional robustness tests ---');

// Capitalization variants
checkSector('bUiLdInG works', 'Construction', 'mixed case');
checkSector('CONSTRUCTION OF ROADS', 'Construction', 'all caps');

// Extra spaces / punctuation
checkSector('  Information   Technology   Services  ', 'IT', 'extra spaces');
checkSector('Consultancy, Advisory & Review Services', 'Consultancy', 'punctuation');
checkSector('Farm-Input Supplies', 'Agriculture', 'hyphenated domain qualifier');

// Combined / edge phrasing from the disambiguation rule
checkSector('Medical Equipment Supply', 'Medical', 'explicit spec example');
checkSector('Farm Input Supplies', 'Agriculture', 'explicit spec example');
checkSector('Supply of Networking Equipment', 'IT', 'domain qualifier before generic supply');

// Completely unknown values
checkSector('Zzzqx Random Category', 'MANUAL REVIEW', 'nonsense input');
checkSector(null, 'MANUAL REVIEW', 'null input');
checkSector(undefined, 'MANUAL REVIEW', 'undefined input');
checkSector('   ', 'MANUAL REVIEW', 'whitespace only');

console.log('');
console.log('=== LOCATION NORMALIZATION TESTS ===');

// Required minimum test cases
checkLocation('Kampala', 'Kampala');
checkLocation('kla', 'Kampala');
checkLocation('KLA City', 'Kampala');
checkLocation('Jinja', 'Jinja');
checkLocation('Jinja Municipality', 'Jinja');
checkLocation('Atlantis', 'MANUAL REVIEW', 'unknown/ambiguous location');
checkLocation('', 'BLANK/NULL', 'empty location');

console.log('');
console.log('--- Additional robustness tests ---');

checkLocation('  kampala  ', 'Kampala', 'extra spaces + lowercase');
checkLocation('KAMPALA', 'Kampala', 'all caps');
checkLocation('Jinja-City', 'Jinja', 'hyphenated variant');
checkLocation('Kabalore', 'MANUAL REVIEW', 'near-miss spelling, not guessed');
checkLocation(null, 'BLANK/NULL', 'null input treated as missing');
checkLocation(undefined, 'BLANK/NULL', 'undefined input treated as missing');

console.log('');
console.log('=== COMBINED OUTPUT STRUCTURE TESTS ===');

const combined1 = normalizeTenderFields({ sector: 'Building & Civil Works', location: 'kla' });
console.log('  Input: sector="Building & Civil Works", location="kla"');
console.log('  Output:', JSON.stringify(combined1, null, 2));

const combined2 = normalizeTenderFields({ sector: 'Environmental Services', location: 'Atlantis' });
console.log('  Input: sector="Environmental Services", location="Atlantis"');
console.log('  Output:', JSON.stringify(combined2, null, 2));

const combined3 = normalizeTenderFields({ sector: 'Health Supplies', location: '' });
console.log('  Input: sector="Health Supplies", location=""');
console.log('  Output:', JSON.stringify(combined3, null, 2));

console.log('');
console.log('=== SUMMARY ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) {
  process.exitCode = 1;
    }
