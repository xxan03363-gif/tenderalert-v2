/**
 * TenderAlert — Supabase Insertion Executor
 *
 * The smallest possible component whose only job is:
 *   READY_FOR_INSERTION record -> safely insert into Tenders
 *
 * This module does NOT normalize, validate, deduplicate, or enrich —
 * those responsibilities belong entirely to the preceding modules. It
 * assumes Final Validation already ran, but does not blindly trust that
 * label alone: as the last gate before a real write, it re-checks the
 * handful of highest-stakes structural facts (required fields present,
 * match_percentage null, requirements/documents correctly typed, immutable
 * facts unchanged) using the SAME comparison functions final-validation.js
 * already exports — reused, not reimplemented, so there is no duplicate
 * copy of that comparison logic to drift out of sync.
 *
 * No credentials of any kind live in this file. The database adapter is
 * injected by the caller — a mock adapter for isolated testing now, and
 * eventually a real Supabase client configured with a server-side
 * environment credential the caller supplies, never this module.
 */

'use strict';

const { factsMatch, deadlinesMatch } = require('./final-validation');

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

const REQUIRED_ASSEMBLED_FIELDS = ['Title', 'Sector', 'Organization', 'deadline'];

/**
 * Last-line-of-defense structural re-check on the exact record about to be
 * written. Deliberately narrow: only the specific facts explicitly called
 * out as insertion-time risks (required fields, match_percentage, array
 * types, immutable-fact drift). This is NOT a re-run of Final Validation's
 * full rule set, and it is NOT the AI fact-invention/prompt-injection
 * system (that stays solely in enrichment.js/final-validation.js).
 */
function sanityCheckRecord(assembledRecord, sourceFacts) {
  const reasons = [];

  if (!assembledRecord) {
    return ['assembledRecord is missing — nothing to insert'];
  }

  REQUIRED_ASSEMBLED_FIELDS.forEach(field => {
    if (isBlank(assembledRecord[field])) {
      reasons.push('Required field "' + field + '" is missing or blank at insertion time');
    }
  });

  if (assembledRecord.match_percentage !== null && assembledRecord.match_percentage !== undefined) {
    reasons.push('match_percentage must be null/absent at insertion time, found: ' + JSON.stringify(assembledRecord.match_percentage));
  }

  ['requirements', 'documents'].forEach(field => {
    const value = assembledRecord[field];
    if (value !== null && value !== undefined && !isStringArray(value)) {
      reasons.push('Field "' + field + '" must be an array of strings when present at insertion time');
    }
  });

  if (sourceFacts) {
    if (!factsMatch(sourceFacts.title, assembledRecord.Title)) reasons.push('Title no longer matches confirmed source facts at insertion time');
    if (!factsMatch(sourceFacts.sector, assembledRecord.Sector)) reasons.push('Sector no longer matches confirmed source facts at insertion time');
    if (!factsMatch(sourceFacts.organization, assembledRecord.Organization)) reasons.push('Organization no longer matches confirmed source facts at insertion time');
    if (!factsMatch(sourceFacts.location, assembledRecord.Location)) reasons.push('Location no longer matches confirmed source facts at insertion time');
    if (!deadlinesMatch(sourceFacts.deadline, assembledRecord.deadline)) reasons.push('Deadline no longer matches confirmed source facts at insertion time');
    if (!factsMatch(sourceFacts.reference, assembledRecord.reference)) reasons.push('Reference no longer matches confirmed source facts at insertion time');
  }

  return reasons;
}

/**
 * executeInsertion({ finalValidationResult, assembledRecord, sourceFacts, adapter })
 *   -> { status: 'INSERTED' | 'REJECTED' | 'FAILED', reasons: string[], record: object|null }
 *
 * sourceFacts is optional but recommended — without it, the immutable-fact
 * cross-check is skipped (only the structural checks run). finalValidate's
 * caller should normally always have sourceFacts on hand, since it's the
 * same object already used earlier in the pipeline.
 */
async function executeInsertion({ finalValidationResult, assembledRecord, sourceFacts, adapter } = {}) {
  if (!finalValidationResult || finalValidationResult.status !== 'READY_FOR_INSERTION') {
    return {
      status: 'REJECTED',
      reasons: ['Final validation status is not READY_FOR_INSERTION (found: ' + (finalValidationResult && finalValidationResult.status) + ') — no insertion attempted.'],
      record: null
    };
  }

  const sanityIssues = sanityCheckRecord(assembledRecord, sourceFacts);
  if (sanityIssues.length > 0) {
    return { status: 'REJECTED', reasons: sanityIssues, record: null };
  }

  if (!adapter || typeof adapter.insert !== 'function') {
    return { status: 'FAILED', reasons: ['No valid database adapter was supplied to the insertion executor.'], record: null };
  }

  try {
    const inserted = await adapter.insert(assembledRecord);
    return { status: 'INSERTED', reasons: ['Record accepted by the database adapter.'], record: inserted };
  } catch (err) {
    // Deliberately generic on the caller-facing side: never include adapter
    // internals that might carry connection strings/credentials. The
    // adapter itself is responsible for keeping its own error messages clean.
    return {
      status: 'FAILED',
      reasons: ['Database insertion failed: ' + (err && err.message ? err.message : 'unknown error')],
      record: null
    };
  }
}

module.exports = { executeInsertion, sanityCheckRecord };
