/**
 * TenderAlert — Pipeline Integration Test
 *
 * Proves that the pipeline modules can actually be chained together in the
 * approved order, with REAL output from one stage feeding the REAL input
 * of the next — not hand-typed "expected" objects standing in for what a
 * prior stage would have produced.
 *
 *   SOURCE -> NORMALIZATION -> VALIDATION -> DEDUPLICATION
 *   -> AI ENRICHMENT (mock adapter) -> RECORD ASSEMBLY -> FINAL VALIDATION
 *   -> MOCK INSERTION EXECUTOR -> INSERTED
 *
 * No network. No Supabase. No live Gemini. No PPDA/e-GP. No credentials.
 * Uses the existing mock AI adapter (enrichment.js) and mock Supabase
 * adapter (mock-supabase-adapter.js) — nothing new simulated, nothing
 * re-implemented.
 */

'use strict';

const { normalizeTenderFields } = require('./normalization');
const { validateTender } = require('./validation');
const { checkDuplicate } = require('./dedup');
const { enrichTender, createMockAdapter } = require('./enrichment');
const { finalValidate } = require('./final-validation');
const { assembleTenderRecord } = require('./record-assembly');
const { executeInsertion } = require('./insertion-executor');
const { createMockSupabaseAdapter } = require('./mock-supabase-adapter');

let pass = 0;
let fail = 0;

function check(label, condition, detail) {
  condition ? pass++ : fail++;
  console.log((condition ? '  PASS ' : '  FAIL ') + label + (detail ? ' — ' + detail : ''));
}

async function main() {
  console.log('=== STEP 1: SOURCE — raw synthetic tender as received from an approved source ===');

  // This is the raw, unprocessed shape a source might realistically provide —
  // deliberately messy sector/location text, exactly like real notices are.
  const rawSourceTender = {
    title: 'Construction of Community Access Road',
    rawSector: 'Building & Civil Works',
    organization: 'Kampala District Local Government',
    rawLocation: 'KLA',
    deadline: '2027-12-15',
    reference: 'PPDA/KDLG/2027/014',
    sourceText:
      'This tender is for the construction of a community access road under Kampala ' +
      'District Local Government. The road is approximately 4km long and requires ' +
      'grading, culvert installation, and gravel surfacing. Bidders must submit a ' +
      'valid company registration certificate and a tax clearance certificate. ' +
      'Bidders must also demonstrate at least three years of experience in road ' +
      'construction. Required documents: certificate of incorporation, tax ' +
      'clearance certificate, technical proposal, and a bill of quantities. ' +
      'Deadline: 15 December 2027.'
  };

  console.log('  Raw sector text: "' + rawSourceTender.rawSector + '"');
  console.log('  Raw location text: "' + rawSourceTender.rawLocation + '"');

  console.log('');
  console.log('=== STEP 2: NORMALIZATION (real normalizeTenderFields call) ===');

  const normalizationResult = normalizeTenderFields({
    sector: rawSourceTender.rawSector,
    location: rawSourceTender.rawLocation
  });

  console.log('  normalizeTenderFields() returned:', JSON.stringify(normalizationResult));

  check('Sector normalized to "Construction"', normalizationResult.normalizedSector === 'Construction');
  check('Location normalized to "Kampala"', normalizationResult.normalizedLocation === 'Kampala');
  check('No manual review required for this clean input', normalizationResult.manualReviewRequired === false);

  // Assemble confirmed source facts using the ACTUAL normalization output —
  // not a hardcoded "Construction"/"Kampala" string typed into this test.
  const sourceFacts = {
    title: rawSourceTender.title,
    sector: normalizationResult.normalizedSector,
    organization: rawSourceTender.organization,
    location: normalizationResult.normalizedLocation,
    deadline: rawSourceTender.deadline,
    reference: rawSourceTender.reference
  };

  console.log('');
  console.log('=== STEP 3: VALIDATION (real validateTender call, using Step 2\'s actual output) ===');

  const validationResult = validateTender(sourceFacts);

  console.log('  validateTender() status:', validationResult.status);
  check('Validation allows the tender to continue', validationResult.status === 'VALID' && validationResult.canContinue === true);

  console.log('');
  console.log('=== STEP 4: DEDUPLICATION (real checkDuplicate call, empty existing-tenders collection) ===');

  const dedupIncoming = {
    title: sourceFacts.title,
    organization: sourceFacts.organization,
    deadline: sourceFacts.deadline,
    reference: sourceFacts.reference
  };

  const dedupResult = checkDuplicate(dedupIncoming, []); // synthetic empty collection, per spec

  console.log('  checkDuplicate() status:', dedupResult.status, '| reasons:', JSON.stringify(dedupResult.reasons));
  check('Deduplication returns NEW against an empty collection', dedupResult.status === 'NEW');

  console.log('');
  console.log('=== STEP 5: AI ENRICHMENT (real enrichTender call, EXISTING mock adapter) ===');

  const mockScenarioResponse = JSON.stringify({
    summary: 'This is a tender for construction of a community access road under Kampala District Local Government, approximately 4km long, including grading, culvert installation, and gravel surfacing, as described in the source text.',
    buyer_wants: 'The district wants a contractor to construct and surface a 4km community access road, including culvert installation.',
    eligibility: 'Bidders must demonstrate at least three years of experience in road construction, as stated in the source text.',
    requirements: ['Valid company registration certificate', 'Tax clearance certificate', 'At least three years of road construction experience'],
    documents: ['Certificate of incorporation', 'Tax clearance certificate', 'Technical proposal', 'Bill of quantities'],
    review_required: false,
    review_reasons: []
  });

  const mockAdapter = createMockAdapter({ community_road_scenario: mockScenarioResponse });

  const aiResult = await enrichTender({
    sourceFacts,
    sourceText: rawSourceTender.sourceText,
    adapter: mockAdapter,
    scenarioKey: 'community_road_scenario'
  });

  console.log('  enrichTender() status:', aiResult.status);
  check('AI enrichment is ACCEPTED', aiResult.status === 'ACCEPTED');
  check('AI output contains no immutable fact fields', aiResult.enriched && !('title' in aiResult.enriched) && !('sector' in aiResult.enriched) &&
    !('organization' in aiResult.enriched) && !('location' in aiResult.enriched) && !('deadline' in aiResult.enriched) && !('reference' in aiResult.enriched));
  check('AI output only contains permitted fields', aiResult.enriched &&
    Object.keys(aiResult.enriched).every(k => ['summary', 'buyer_wants', 'eligibility', 'requirements', 'documents', 'review_required', 'review_reasons'].includes(k)));

  console.log('');
  console.log('=== STEP 6: RECORD ASSEMBLY (real assembleTenderRecord call, using Step 5\'s actual output) ===');

  const assemblyResult = assembleTenderRecord({ sourceFacts, aiResult });

  console.log('  assembleTenderRecord() ok:', assemblyResult.ok);
  check('Record assembly succeeded', assemblyResult.ok === true);

  const assembledRecord = assemblyResult.record;

  console.log('  Assembled record:', JSON.stringify(assembledRecord, null, 2));

  const expectedSchemaKeys = [
    'Title', 'Sector', 'Organization', 'Location', 'deadline', 'match_percentage',
    'reference', 'summary', 'buyer_wants', 'eligibility', 'Requirements', 'Documents'
  ];
  check('Assembled record matches the approved Tenders schema field set (id/created_at are DB-generated, correctly absent)',
    expectedSchemaKeys.every(k => Object.prototype.hasOwnProperty.call(assembledRecord, k)) &&
    Object.keys(assembledRecord).every(k => expectedSchemaKeys.includes(k)));
  check('match_percentage is null in the assembled record', assembledRecord.match_percentage === null);

  console.log('');
  console.log('=== STEP 7: FINAL VALIDATION (real finalValidate call, using every real prior-stage output) ===');

  const finalResult = finalValidate({
    sourceFacts,
    validationResult,
    dedupResult,
    aiResult,
    assembledRecord,
    dedupOverrideApproved: false
  });

  console.log('  finalValidate() status:', finalResult.status);
  console.log('  reasons:', JSON.stringify(finalResult.reasons));
  check('Final Validation returns READY_FOR_INSERTION', finalResult.status === 'READY_FOR_INSERTION');

  console.log('');
  console.log('=== STEP 8: MOCK INSERTION EXECUTOR (real executeInsertion call, using Step 7\'s actual READY_FOR_INSERTION result) ===');

  const mockSupabaseAdapter = createMockSupabaseAdapter();

  const insertionResult = await executeInsertion({
    finalValidationResult: finalResult,
    assembledRecord,
    sourceFacts,
    adapter: mockSupabaseAdapter
  });

  console.log('  executeInsertion() status:', insertionResult.status);
  console.log('  reasons:', JSON.stringify(insertionResult.reasons));
  check('Insertion executor returns INSERTED', insertionResult.status === 'INSERTED');
  check('Exactly one insertion attempt was made', mockSupabaseAdapter.getAttemptCount() === 1);
  check('Inserted record preserves match_percentage as null', insertionResult.record && insertionResult.record.match_percentage === null);
  check('Inserted record carries DB-generated id/created_at (mock)', insertionResult.record && !!insertionResult.record.id && !!insertionResult.record.created_at);
  check('Inserted record\'s immutable fields still match confirmed source facts', insertionResult.record &&
    insertionResult.record.Title === sourceFacts.title && insertionResult.record.Sector === sourceFacts.sector &&
    insertionResult.record.Organization === sourceFacts.organization && insertionResult.record.deadline === sourceFacts.deadline);

  console.log('');
  console.log('=== IMMUTABLE FIELDS UNCHANGED, END TO END ===');
  check('Title unchanged from raw source through to assembled record', assembledRecord.Title === rawSourceTender.title);
  check('Organization unchanged from raw source through to assembled record', assembledRecord.Organization === rawSourceTender.organization);
  check('Deadline unchanged from raw source through to assembled record', assembledRecord.deadline === rawSourceTender.deadline);
  check('Reference unchanged from raw source through to assembled record', assembledRecord.reference === rawSourceTender.reference);
  check('Sector reflects normalization output, not the raw messy source text', assembledRecord.Sector === 'Construction' && assembledRecord.Sector !== rawSourceTender.rawSector);
  check('Location reflects normalization output, not the raw messy source text', assembledRecord.Location === 'Kampala' && assembledRecord.Location !== rawSourceTender.rawLocation);

  console.log('');
  console.log('=== NEGATIVE CASE (Part E): a mutation introduced after enrichment must be caught ===');

  const tamperedRecord = Object.assign({}, assembledRecord, { Title: 'A Tampered Title Nobody Approved' });

  const negativeResult = finalValidate({
    sourceFacts,
    validationResult,
    dedupResult,
    aiResult,
    assembledRecord: tamperedRecord,
    dedupOverrideApproved: false
  });

  console.log('  finalValidate() status on tampered record:', negativeResult.status);
  console.log('  reasons:', JSON.stringify(negativeResult.reasons));
  check('Tampered Title is REJECTED, not allowed to become READY_FOR_INSERTION', negativeResult.status === 'REJECTED');
  check('Rejection reason names the Title mismatch specifically', negativeResult.reasons.join(' | ').includes('Title integrity mismatch'));

  const negativeInsertionAdapter = createMockSupabaseAdapter();
  const negativeInsertionResult = await executeInsertion({
    finalValidationResult: negativeResult, // REJECTED — must never reach the database
    assembledRecord: tamperedRecord,
    sourceFacts,
    adapter: negativeInsertionAdapter
  });

  console.log('  executeInsertion() status on REJECTED final result:', negativeInsertionResult.status);
  check('Insertion executor refuses to write a REJECTED-final-result record', negativeInsertionResult.status === 'REJECTED');
  check('Zero insertion attempts were made for the rejected/tampered record', negativeInsertionAdapter.getAttemptCount() === 0);

  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Passed: ' + pass);
  console.log('Failed: ' + fail);

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main();
