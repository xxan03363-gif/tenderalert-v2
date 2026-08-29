/**
 * TenderAlert — Final Validation Module
 *
 * Standalone, reusable module intended to sit here in the pipeline:
 *   SOURCE -> NORMALIZATION -> VALIDATION -> DEDUPLICATION
 *   -> GEMINI AI ENRICHMENT -> FINAL VALIDATION -> SUPABASE
 *
 * This module does NOT write to Supabase, does NOT call Gemini, does NOT
 * touch the dashboard or any database. It takes the outputs of every prior
 * stage plus a candidate record shaped like the real "Tenders" table, and
 * decides whether that candidate MAY be handed to a future insertion
 * executor. It never performs the insertion itself.
 *
 * READY_FOR_INSERTION means only:
 *   "This candidate passed the dry-run safety gate."
 * It does not mean anything was written anywhere.
 */

'use strict';

const { SECTORS } = require('./normalization');
const { parseDeadline } = require('./validation');

/* ============================================================
   SHARED HELPERS
   ============================================================ */

function toPlainString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function isBlank(value) {
  return toPlainString(value).trim() === '';
}

// Exact-value equality for immutable fact comparison. Deliberately strict —
// these fields should be byte-for-byte identical across stages; any drift
// (even whitespace) is worth surfacing rather than silently trimming away,
// since it may indicate a real pipeline bug.
function factsMatch(a, b) {
  const blankA = isBlank(a);
  const blankB = isBlank(b);
  if (blankA && blankB) return true;
  if (blankA !== blankB) return false;
  return toPlainString(a) === toPlainString(b);
}

// Deadline comparison uses the same strict ISO-8601 parser as the
// validation stage, comparing normalized calendar dates rather than raw
// strings (so "2027-09-28" and "2027-09-28T00:00:00Z" are recognized as
// the same fact, while a genuinely different date is not).
function deadlinesMatch(a, b) {
  const blankA = isBlank(a);
  const blankB = isBlank(b);
  if (blankA && blankB) return true;
  if (blankA !== blankB) return false;

  const parsedA = parseDeadline(a);
  const parsedB = parseDeadline(b);
  if (!parsedA.valid || !parsedB.valid) return false;
  return parsedA.dateOnly === parsedB.dateOnly;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/* ============================================================
   STEP 1 — PIPELINE-STAGE CONSISTENCY
   ============================================================
   Each issue found here is a HOLD_FOR_REVIEW-level concern: it means an
   earlier stage flagged genuine uncertainty, not that this stage found a
   concrete integrity violation.
*/

function checkStageConsistency({ validationResult, dedupResult, aiResult, dedupOverrideApproved }) {
  const blockingHoldReasons = [];
  const infoNotes = [];

  if (!validationResult || validationResult.status !== 'VALID') {
    blockingHoldReasons.push(
      'Validation stage status is "' + (validationResult && validationResult.status) +
      '", not VALID — record should not have reached Final Validation without a clean VALID result.'
    );
  }

  if (!dedupResult || dedupResult.status !== 'NEW') {
    if (dedupOverrideApproved) {
      infoNotes.push(
        'Deduplication status is "' + (dedupResult && dedupResult.status) +
        '" but an explicitly approved override was supplied — this does not block the record, and the override is recorded here for auditability.'
      );
    } else {
      blockingHoldReasons.push(
        'Deduplication status is "' + (dedupResult && dedupResult.status) +
        '", not NEW, and no explicit override was supplied.'
      );
    }
  }

  if (!aiResult || aiResult.status !== 'ACCEPTED') {
    blockingHoldReasons.push(
      'AI enrichment status is "' + (aiResult && aiResult.status) +
      '", not ACCEPTED — record should not proceed without accepted enrichment output.'
    );
  }

  return { blockingHoldReasons, infoNotes };
}

/* ============================================================
   STEP 2 — IMMUTABLE FACT INTEGRITY
   ============================================================
   Independently re-verifies the assembled record's fact columns against
   the confirmed sourceFacts — defense in depth, not just trusting that
   upstream stages got it right. Every mismatch here is a REJECTED-level
   concern: a concrete integrity violation, not ambiguity.
*/

function checkFactIntegrity(sourceFacts, assembledRecord) {
  const rejectReasons = [];
  sourceFacts = sourceFacts || {};
  assembledRecord = assembledRecord || {};

  if (!factsMatch(sourceFacts.title, assembledRecord.Title)) {
    rejectReasons.push('Title integrity mismatch: source="' + sourceFacts.title + '" vs assembled="' + assembledRecord.Title + '"');
  }

  if (!factsMatch(sourceFacts.sector, assembledRecord.Sector)) {
    rejectReasons.push('Sector integrity mismatch: source="' + sourceFacts.sector + '" vs assembled="' + assembledRecord.Sector + '"');
  } else if (!isBlank(assembledRecord.Sector) && !SECTORS.includes(assembledRecord.Sector)) {
    rejectReasons.push('Sector "' + assembledRecord.Sector + '" is not one of the six recognized TenderAlert sectors');
  }

  if (!factsMatch(sourceFacts.organization, assembledRecord.Organization)) {
    rejectReasons.push('Organization integrity mismatch: source="' + sourceFacts.organization + '" vs assembled="' + assembledRecord.Organization + '"');
  }

  if (!factsMatch(sourceFacts.location, assembledRecord.Location)) {
    rejectReasons.push('Location integrity mismatch: source="' + sourceFacts.location + '" vs assembled="' + assembledRecord.Location + '"');
  }

  if (!deadlinesMatch(sourceFacts.deadline, assembledRecord.deadline)) {
    rejectReasons.push('Deadline integrity mismatch: source="' + sourceFacts.deadline + '" vs assembled="' + assembledRecord.deadline + '"');
  }

  if (!factsMatch(sourceFacts.reference, assembledRecord.reference)) {
    rejectReasons.push('Reference integrity mismatch: source="' + sourceFacts.reference + '" vs assembled="' + assembledRecord.reference + '"');
  }

  return rejectReasons;
}

/* ============================================================
   STEP 3 — SCHEMA / TYPE CONFORMANCE
   ============================================================
   Checks against the ACTUAL Tenders column names/casing. "Required" here
   reflects this pipeline's own logical requirements (matching what the
   Validation stage already enforces) — not a claim about the live table's
   underlying SQL constraints, which this module does not inspect or change.
   id/created_at are DB-generated and are allowed to be absent from a
   pre-insertion candidate record.
*/

const REQUIRED_NON_BLANK_FIELDS = ['Title', 'Sector', 'Organization', 'deadline'];

function checkSchemaConformance(assembledRecord) {
  const rejectReasons = [];
  assembledRecord = assembledRecord || {};

  REQUIRED_NON_BLANK_FIELDS.forEach(field => {
    if (isBlank(assembledRecord[field])) {
      rejectReasons.push('Required field "' + field + '" is missing or blank in the assembled record');
    }
  });

  if (!isBlank(assembledRecord.deadline)) {
    const parsed = parseDeadline(assembledRecord.deadline);
    if (!parsed.valid) {
      rejectReasons.push('Assembled record deadline is not a valid date/datetime: ' + parsed.reason);
    }
  }

  // match_percentage MUST remain null/absent during ingestion — never a
  // Gemini-generated or otherwise pre-populated global score.
  if (assembledRecord.match_percentage !== null && assembledRecord.match_percentage !== undefined) {
    rejectReasons.push('match_percentage must be null/absent at ingestion time, but found: ' + JSON.stringify(assembledRecord.match_percentage));
  }

  ['requirements', 'documents'].forEach(field => {
    const value = assembledRecord[field];
    if (value !== null && value !== undefined && !isStringArray(value)) {
      rejectReasons.push('Field "' + field + '" must be an array of strings when present (got ' + JSON.stringify(value) + ')');
    }
  });

  ['summary', 'buyer_wants', 'eligibility'].forEach(field => {
    const value = assembledRecord[field];
    if (value !== null && value !== undefined && typeof value !== 'string') {
      rejectReasons.push('Field "' + field + '" must be a string when present (got ' + typeof value + ')');
    }
  });

  return rejectReasons;
}

/* ============================================================
   TOP-LEVEL FINAL VALIDATION
   ============================================================
   finalValidate({
     sourceFacts, validationResult, dedupResult, aiResult,
     assembledRecord, dedupOverrideApproved
   }) -> {
     status: 'READY_FOR_INSERTION' | 'HOLD_FOR_REVIEW' | 'REJECTED',
     reasons: string[]
   }
*/

function finalValidate(input) {
  input = input || {};

  const rejectReasons = [
    ...checkFactIntegrity(input.sourceFacts, input.assembledRecord),
    ...checkSchemaConformance(input.assembledRecord)
  ];

  const { blockingHoldReasons, infoNotes } = checkStageConsistency(input);

  if (rejectReasons.length > 0) {
    return { status: 'REJECTED', reasons: rejectReasons.concat(blockingHoldReasons).concat(infoNotes) };
  }

  if (blockingHoldReasons.length > 0) {
    return { status: 'HOLD_FOR_REVIEW', reasons: blockingHoldReasons.concat(infoNotes) };
  }

  const readyReasons = ['Passed all Final Validation checks. This is a dry-run result only — no data has been written to Supabase, and this module does not perform insertion.'];
  return {
    status: 'READY_FOR_INSERTION',
    reasons: readyReasons.concat(infoNotes)
  };
}

module.exports = {
  finalValidate,
  checkStageConsistency,
  checkFactIntegrity,
  checkSchemaConformance,
  factsMatch,
  deadlinesMatch
};
