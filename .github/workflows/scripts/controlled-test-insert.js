/**
 * TenderAlert — Controlled Test Insert Script
 *
 * Runs ONE synthetic, obviously-fake tender through the COMPLETE pipeline:
 *   normalization -> validation -> deduplication -> AI enrichment
 *   -> record assembly -> final validation -> insertion executor
 *
 * AI enrichment uses the MOCK adapter, not real Gemini — Gemini has never
 * been connected/approved for live use, and this script does not change
 * that. Only the LAST stage (insertion executor) uses the REAL Supabase
 * adapter — that is the one and only real write in this entire script.
 *
 * Inserts exactly once, and only if every single gate passes. If any
 * stage rejects the record, this script stops there and nothing is
 * written to Supabase.
 *
 * Intended to be run manually only, via the "Controlled Test Insert"
 * GitHub Actions workflow. Never runs automatically or on a schedule.
 */

'use strict';

const { normalizeTenderFields } = require('../normalization');
const { validateTender } = require('../validation');
const { checkDuplicate } = require('../dedup');
const { enrichTender, createMockAdapter } = require('../enrichment');
const { assembleTenderRecord } = require('../record-assembly');
const { finalValidate } = require('../final-validation');
const { executeInsertion } = require('../insertion-executor');
const { createSupabaseAdapter } = require('../supabase-adapter');

async function main() {
  const runId = process.env.GITHUB_RUN_ID || ('local-' + Date.now());

  console.log('=== CONTROLLED TEST INSERT — run ' + runId + ' ===');
  console.log('This will attempt exactly ONE real Supabase insert, only if every pipeline gate passes.');
  console.log('');

  // Deliberately obvious synthetic test data. Raw, messy sector/location
  // text is used on purpose, to prove normalization genuinely runs here —
  // not pre-cleaned input standing in for it.
  const rawSourceTender = {
    title: 'TEST RECORD - AUTOMATED PIPELINE TEST - SAFE TO DELETE',
    rawSector: 'Building & Civil Works', // expected to normalize to Construction
    organization: 'TEST ORGANIZATION - DO NOT USE',
    rawLocation: 'KLA', // expected to normalize to Kampala
    deadline: '2027-12-31',
    reference: 'TEST-INSERT-' + runId, // unique per run — unmistakably a test, safely re-runnable
    sourceText:
      'This is a synthetic test tender created by an automated pipeline test. ' +
      'It is not a real procurement opportunity. Required documents: test document. ' +
      'Deadline: 31 December 2027.'
  };

  console.log('STEP 1/8 — SOURCE');
  console.log('  Title: ' + rawSourceTender.title);
  console.log('  Reference: ' + rawSourceTender.reference);
  console.log('');

  console.log('STEP 2/8 — NORMALIZATION');
  const normalizationResult = normalizeTenderFields({
    sector: rawSourceTender.rawSector,
    location: rawSourceTender.rawLocation
  });
  console.log('  Sector: "' + rawSourceTender.rawSector + '" -> ' + normalizationResult.normalizedSector);
  console.log('  Location: "' + rawSourceTender.rawLocation + '" -> ' + normalizationResult.normalizedLocation);
  if (normalizationResult.manualReviewRequired) {
    console.error('ABORTED at normalization. Reasons: ' + normalizationResult.reasons.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('');

  const sourceFacts = {
    title: rawSourceTender.title,
    sector: normalizationResult.normalizedSector,
    organization: rawSourceTender.organization,
    location: normalizationResult.normalizedLocation,
    deadline: rawSourceTender.deadline,
    reference: rawSourceTender.reference
  };

  console.log('STEP 3/8 — VALIDATION');
  const validationResult = validateTender(sourceFacts);
  console.log('  Status: ' + validationResult.status);
  if (validationResult.status !== 'VALID') {
    console.error('ABORTED at validation. Reasons: ' + validationResult.reasons.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('');

  console.log('STEP 4/8 — DEDUPLICATION');
  // Checked against an empty existing-tenders set, same as the already
  // approved integration test. The unique per-run reference above means
  // this script can be safely re-run without colliding with a prior
  // test row.
  const dedupResult = checkDuplicate({
    title: sourceFacts.title,
    organization: sourceFacts.organization,
    deadline: sourceFacts.deadline,
    reference: sourceFacts.reference
  }, []);
  console.log('  Status: ' + dedupResult.status);
  if (dedupResult.status !== 'NEW') {
    console.error('ABORTED at deduplication. Reasons: ' + dedupResult.reasons.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('');

  console.log('STEP 5/8 — AI ENRICHMENT (MOCK adapter — real Gemini is not connected)');
  const mockResponse = JSON.stringify({
    summary: 'This is a synthetic test tender created by an automated pipeline test, as stated in the source text.',
    buyer_wants: 'N/A - this is a test record, not a real procurement request.',
    eligibility: 'N/A - this is a test record.',
    requirements: ['Test requirement - not real'],
    documents: ['Test document - not real'],
    review_required: false,
    review_reasons: []
  });
  const mockAdapter = createMockAdapter({ test_scenario: mockResponse });
  const aiResult = await enrichTender({
    sourceFacts,
    sourceText: rawSourceTender.sourceText,
    adapter: mockAdapter,
    scenarioKey: 'test_scenario'
  });
  console.log('  Status: ' + aiResult.status);
  if (aiResult.status !== 'ACCEPTED') {
    console.error('ABORTED at AI enrichment. Reasons: ' + aiResult.reasons.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('');

  console.log('STEP 6/8 — RECORD ASSEMBLY');
  const assemblyResult = assembleTenderRecord({ sourceFacts, aiResult });
  console.log('  ok: ' + assemblyResult.ok);
  if (!assemblyResult.ok) {
    console.error('ABORTED at record assembly. Reason: ' + assemblyResult.reason);
    process.exitCode = 1;
    return;
  }
  const assembledRecord = assemblyResult.record;
  console.log('  Assembled record (about to be checked, NOT yet written):');
  console.log(JSON.stringify(assembledRecord, null, 2));
  console.log('');

  console.log('STEP 7/8 — FINAL VALIDATION');
  const finalResult = finalValidate({
    sourceFacts,
    validationResult,
    dedupResult,
    aiResult,
    assembledRecord,
    dedupOverrideApproved: false
  });
  console.log('  Status: ' + finalResult.status);
  if (finalResult.status !== 'READY_FOR_INSERTION') {
    console.error('ABORTED at Final Validation. Reasons: ' + finalResult.reasons.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('');

  console.log('STEP 8/8 — INSERTION EXECUTOR (REAL Supabase adapter — this is the actual write)');
  const realAdapter = createSupabaseAdapter();
  const insertionResult = await executeInsertion({
    finalValidationResult: finalResult,
    assembledRecord,
    sourceFacts,
    adapter: realAdapter
  });

  console.log('  Status: ' + insertionResult.status);
  console.log('  Reasons: ' + JSON.stringify(insertionResult.reasons));

  if (insertionResult.status === 'INSERTED') {
    console.log('');
    console.log('=== SUCCESS ===');
    console.log('Inserted row id: ' + insertionResult.record.id);
    console.log('Inserted row created_at: ' + insertionResult.record.created_at);
    console.log('Reference to search for in Supabase: ' + sourceFacts.reference);
    console.log('This is a TEST record. Verify it in your dashboard or Supabase Table Editor, then delete it manually.');
  } else {
    console.error('Insertion did not succeed. Nothing was written — no cleanup needed.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR: ' + err.message);
  process.exitCode = 1;
});
