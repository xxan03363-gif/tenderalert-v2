/**
 * TenderAlert — Record Assembly Test Suite
 * Local/synthetic only. Does NOT touch Supabase, the dashboard, or any live source.
 */

'use strict';

const { assembleTenderRecord } = require('./record-assembly');

let pass = 0;
let fail = 0;

function run(label, input, expectedOk, extraCheck) {
  const result = assembleTenderRecord(input);
  let ok = result.ok === expectedOk;
  if (ok && extraCheck) ok = extraCheck(result);

  ok ? pass++ : fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + ' -> ok=' + result.ok + (result.reason ? ' (' + result.reason + ')' : ''));
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

function baselineAiResult() {
  return {
    status: 'ACCEPTED',
    enriched: {
      summary: 'A sample summary.',
      buyer_wants: 'A sample buyer_wants statement.',
      eligibility: 'A sample eligibility statement.',
      requirements: ['Requirement A', 'Requirement B'],
      documents: ['Document A'],
      review_required: false,
      review_reasons: []
    },
    reasons: [],
    raw: null
  };
}

console.log('=== RECORD ASSEMBLY TESTS ===');

// 1. Fully valid pipeline result -> correctly assembled Tenders record
run('1. Fully valid pipeline result', { sourceFacts: baselineSourceFacts(), aiResult: baselineAiResult() }, true, r =>
  r.record.Title === 'Construction of District Roads' &&
  r.record.Sector === 'Construction' &&
  r.record.Organization === 'Ministry of Works' &&
  r.record.Location === 'Kampala' &&
  r.record.deadline === '2027-09-28' &&
  r.record.reference === 'PPDA/DEMO/2026/001'
);

// 2. Nullable location absent -> allowed
run('2. Nullable location absent', { sourceFacts: { ...baselineSourceFacts(), location: undefined }, aiResult: baselineAiResult() }, true, r => r.record.Location === null);

// 3. Nullable reference absent -> allowed
run('3. Nullable reference absent', { sourceFacts: { ...baselineSourceFacts(), reference: undefined }, aiResult: baselineAiResult() }, true, r => r.record.reference === null);

// 4. AI fields correctly mapped
run('4. AI fields correctly mapped', { sourceFacts: baselineSourceFacts(), aiResult: baselineAiResult() }, true, r =>
  r.record.summary === 'A sample summary.' &&
  r.record.buyer_wants === 'A sample buyer_wants statement.' &&
  r.record.eligibility === 'A sample eligibility statement.' &&
  JSON.stringify(r.record.requirements) === JSON.stringify(['Requirement A', 'Requirement B']) &&
  JSON.stringify(r.record.documents) === JSON.stringify(['Document A'])
);

// 5. match_percentage absent/null, always — even if something upstream tried to sneak a value in via enriched
run('5. match_percentage always null, even if enriched carries a rogue value', {
  sourceFacts: baselineSourceFacts(),
  aiResult: { status: 'ACCEPTED', enriched: { ...baselineAiResult().enriched, match_percentage: 999 }, reasons: [], raw: null }
}, true, r => r.record.match_percentage === null);

// 6. Immutable fields exactly preserved
run('6. Immutable fields exactly preserved', { sourceFacts: baselineSourceFacts(), aiResult: baselineAiResult() }, true, r => {
  const sf = baselineSourceFacts();
  return r.record.Title === sf.title && r.record.Sector === sf.sector && r.record.Organization === sf.organization &&
    r.record.Location === sf.location && r.record.deadline === sf.deadline && r.record.reference === sf.reference;
});

// 7. No unexpected database columns added
const expectedColumns = ['Title', 'Sector', 'Organization', 'Location', 'deadline', 'match_percentage', 'reference', 'summary', 'buyer_wants', 'eligibility', 'requirements', 'documents'];
run('7. No unexpected database columns added', { sourceFacts: baselineSourceFacts(), aiResult: baselineAiResult() }, true, r =>
  Object.keys(r.record).length === expectedColumns.length &&
  expectedColumns.every(c => Object.prototype.hasOwnProperty.call(r.record, c))
);

// 8. Incorrect pipeline status cannot produce an insertion-ready record
run('8a. AI result status REVIEW -> refused', { sourceFacts: baselineSourceFacts(), aiResult: { status: 'REVIEW', enriched: null, reasons: [], raw: null } }, false);
run('8b. AI result status REJECTED -> refused', { sourceFacts: baselineSourceFacts(), aiResult: { status: 'REJECTED', enriched: null, reasons: [], raw: null } }, false);
run('8c. AI result missing entirely -> refused', { sourceFacts: baselineSourceFacts(), aiResult: null }, false);
run('8d. sourceFacts missing entirely -> refused', { sourceFacts: null, aiResult: baselineAiResult() }, false);
run('8e. sourceFacts missing required field (organization) -> refused', { sourceFacts: { ...baselineSourceFacts(), organization: '' }, aiResult: baselineAiResult() }, false);

console.log('');
console.log('=== SUMMARY ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) {
  process.exitCode = 1;
}
