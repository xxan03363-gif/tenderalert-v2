/**
 * TenderAlert — Record Assembly Module
 *
 * The single approved place where internal pipeline field names are mapped
 * to the exact Tenders database column names/casing. Replaces the
 * hand-written assembly glue that previously lived inline in the
 * integration test.
 *
 * This module does NOT touch Supabase, does NOT call Gemini, and does NOT
 * perform normalization, validation, or deduplication itself — it only
 * maps already-confirmed values into the database-shaped record.
 */

'use strict';

function isBlankOrMissing(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * assembleTenderRecord({ sourceFacts, aiResult }) -> {
 *   ok: boolean,
 *   record: object|null,   // exact Tenders column shape (id/created_at excluded — DB-generated)
 *   reason: string|null
 * }
 *
 * sourceFacts: { title, sector, organization, location, deadline, reference }
 *   — the confirmed immutable facts, already normalized and validated.
 * aiResult: the full return value of enrichment.js's enrichTender() —
 *   { status, enriched, reasons, raw } — status MUST be 'ACCEPTED'.
 */
function assembleTenderRecord({ sourceFacts, aiResult } = {}) {
  if (!sourceFacts) {
    return { ok: false, record: null, reason: 'sourceFacts is missing — cannot assemble a record without confirmed source facts' };
  }

  if (isBlankOrMissing(sourceFacts.title) || isBlankOrMissing(sourceFacts.sector) ||
      isBlankOrMissing(sourceFacts.organization) || isBlankOrMissing(sourceFacts.deadline)) {
    return { ok: false, record: null, reason: 'sourceFacts is missing one or more required immutable fields (title, sector, organization, deadline)' };
  }

  if (!aiResult || aiResult.status !== 'ACCEPTED' || !aiResult.enriched) {
    return {
      ok: false,
      record: null,
      reason: 'AI enrichment result is not ACCEPTED (found status: ' + (aiResult && aiResult.status) + ') — refusing to assemble a record from unaccepted or absent enrichment output'
    };
  }

  const enriched = aiResult.enriched;

  // Deliberate allow-list field-by-field construction — never a spread of
  // `enriched` or `sourceFacts`. This is what structurally guarantees the
  // assembled record can never inherit an unexpected key from either input,
  // including an immutable-field key the AI output might (still) contain.
  const record = {
    Title: sourceFacts.title,
    Sector: sourceFacts.sector,
    Organization: sourceFacts.organization,
    Location: isBlankOrMissing(sourceFacts.location) ? null : sourceFacts.location,
    deadline: sourceFacts.deadline,
    reference: isBlankOrMissing(sourceFacts.reference) ? null : sourceFacts.reference,
    match_percentage: null, // hard-coded, always — never derived from aiResult or any other input
    summary: enriched.summary !== undefined ? enriched.summary : null,
    buyer_wants: enriched.buyer_wants !== undefined ? enriched.buyer_wants : null,
    eligibility: enriched.eligibility !== undefined ? enriched.eligibility : null,
    requirements: enriched.requirements !== undefined ? enriched.requirements : [],
    documents: enriched.documents !== undefined ? enriched.documents : []
  };

  return { ok: true, record, reason: null };
}

module.exports = { assembleTenderRecord };
