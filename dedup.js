/**
 * TenderAlert — Tender Deduplication Module
 *
 * Standalone, reusable module intended to sit here in the future pipeline:
 *   SOURCE -> NORMALIZATION -> VALIDATION -> DEDUPLICATION -> AI ENRICHMENT -> SUPABASE
 *
 * This module does NOT touch Supabase, the dashboard, or any live source.
 * It is pure logic + a local test suite, meant to be reviewed before wiring in.
 *
 * Design principles:
 *  - Reference number is the primary duplicate signal, when available.
 *  - Fingerprint (normalized Title + Organization + deadline) is the fallback.
 *  - Nothing is ever auto-merged. Uncertain cases return POSSIBLE_DUPLICATE
 *    or REVIEW, never silently discarded or silently treated as NEW.
 *  - Source-aware: reference normalization can vary per source without any
 *    source being hard-coded into the core logic.
 */

'use strict';

/* ============================================================
   TEXT NORMALIZATION HELPERS
   ============================================================ */

function cleanText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[\/&,.\-_()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlank(raw) {
  return cleanText(raw) === '';
}

// Normalize a deadline value to a canonical YYYY-MM-DD string.
// Returns null if the value is missing or not a parseable date.
function normalizeDeadline(rawDeadline) {
  if (rawDeadline === null || rawDeadline === undefined || String(rawDeadline).trim() === '') {
    return null;
  }
  const d = new Date(rawDeadline);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/* ============================================================
   REFERENCE NORMALIZATION (source-aware)
   ============================================================
   Different approved sources may format reference numbers differently.
   This registry lets a per-source normalizer be plugged in later WITHOUT
   hard-coding any specific source (e.g. e-GP) into the core dedup logic.
   If no source-specific normalizer is registered, a generic default is used.
*/

const REFERENCE_NORMALIZERS = {
  // Example of how a future source could be registered:
  // 'source-name': (ref) => cleanText(ref).toUpperCase().replace(/\s+/g, '')
};

function defaultReferenceNormalizer(ref) {
  if (ref === null || ref === undefined) return '';
  return String(ref)
    .toLowerCase()
    .replace(/\s+/g, '')       // remove all whitespace
    .replace(/[^a-z0-9/-]/g, ''); // keep alphanumerics and / -
}

function normalizeReference(rawReference, sourceName) {
  const normalizer = (sourceName && REFERENCE_NORMALIZERS[sourceName]) || defaultReferenceNormalizer;
  const normalized = normalizer(rawReference);
  return normalized === '' ? null : normalized;
}

/* ============================================================
   FINGERPRINT GENERATION
   ============================================================
   Deterministic fingerprint from normalized Title + Organization + deadline.
   Small formatting differences (case, spacing, punctuation) do NOT produce
   different fingerprints. Wording differences DO — that's intentional;
   genuine wording variation is handled separately via similarity scoring,
   not folded into the fingerprint itself.
*/

function generateFingerprint({ title, organization, deadline }) {
  const cleanTitle = cleanText(title);
  const cleanOrg = cleanText(organization);
  const normDeadline = normalizeDeadline(deadline);

  if (!cleanTitle || !cleanOrg || !normDeadline) {
    return null; // Cannot build a reliable fingerprint from incomplete data.
  }

  return cleanTitle + '|' + cleanOrg + '|' + normDeadline;
}

/* ============================================================
   TITLE SIMILARITY (for "slight wording variation" detection)
   ============================================================
   Deterministic Levenshtein-based similarity ratio, 0..1.
   Used ONLY to flag near-matches for human review — never to
   auto-classify something as a confirmed duplicate.
*/

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,          // deletion
        dp[j - 1] + 1,      // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
      prev = temp;
    }
  }
  return dp[n];
}

function titleSimilarity(titleA, titleB) {
  const a = cleanText(titleA);
  const b = cleanText(titleB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

const NEAR_MATCH_THRESHOLD = 0.82; // Tunable. Below this = considered unrelated.

/* ============================================================
   VALIDATION
   ============================================================ */

function validateCoreFields(tender) {
  const missing = [];
  if (isBlank(tender.title)) missing.push('title');
  if (isBlank(tender.organization)) missing.push('organization');
  if (normalizeDeadline(tender.deadline) === null) missing.push('deadline');
  return missing;
}

/* ============================================================
   CORE DEDUPLICATION LOGIC
   ============================================================
   checkDuplicate(incoming, existingTenders) -> {
     status: 'NEW' | 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'REVIEW',
     reasons: string[],
     matchedRecordId: any|null,
     incomingReferenceNormalized: string|null,
     incomingFingerprint: string|null
   }

   `incoming` shape: { title, organization, deadline, reference, sourceName }
   `existingTenders` shape: array of { id, title, organization, deadline, reference }
     (field names deliberately lowercase here — this is the module's internal
     contract; mapping from the real "Tenders" table's actual column names,
     e.g. "Title"/"Organization", happens at the integration point, not here.)
*/

function checkDuplicate(incoming, existingTenders) {
  existingTenders = existingTenders || [];

  // Step 1 — validate required core fields.
  const missingFields = validateCoreFields(incoming);
  if (missingFields.length > 0) {
    return {
      status: 'REVIEW',
      reasons: ['Missing required field(s) for reliable deduplication: ' + missingFields.join(', ')],
      matchedRecordId: null,
      incomingReferenceNormalized: normalizeReference(incoming.reference, incoming.sourceName),
      incomingFingerprint: null
    };
  }

  const incomingRefNorm = normalizeReference(incoming.reference, incoming.sourceName);
  const incomingFingerprint = generateFingerprint(incoming);

  // Precompute normalized reference + fingerprint for every existing record.
  const enrichedExisting = existingTenders.map(rec => ({
    record: rec,
    refNorm: normalizeReference(rec.reference, rec.sourceName),
    fingerprint: generateFingerprint(rec)
  }));

  const referenceMatch = incomingRefNorm
    ? enrichedExisting.find(e => e.refNorm !== null && e.refNorm === incomingRefNorm)
    : null;

  const fingerprintMatch = incomingFingerprint
    ? enrichedExisting.find(e => e.fingerprint !== null && e.fingerprint === incomingFingerprint)
    : null;

  // Step 2 — reference match found (primary signal).
  if (referenceMatch) {
    if (fingerprintMatch && fingerprintMatch.record === referenceMatch.record) {
      // Same reference AND same core fields — confident duplicate.
      return {
        status: 'DUPLICATE',
        reasons: ['Matched existing record by normalized reference, and title/organization/deadline agree.'],
        matchedRecordId: referenceMatch.record.id,
        incomingReferenceNormalized: incomingRefNorm,
        incomingFingerprint
      };
    }
    // Same reference, but core fields disagree — conflicting data under one reference number.
    return {
      status: 'REVIEW',
      reasons: ['Reference number matches an existing record, but title/organization/deadline differ. Possible data conflict — needs human review.'],
      matchedRecordId: referenceMatch.record.id,
      incomingReferenceNormalized: incomingRefNorm,
      incomingFingerprint
    };
  }

  // Step 3 — no reference match (either no reference provided, or reference
  // is new/unmatched). Fall back to fingerprint.
  if (fingerprintMatch) {
    const existingRefNorm = fingerprintMatch.refNorm;

    if (!incomingRefNorm && !existingRefNorm) {
      // Neither record has a reference — fingerprint is all we have, and it matches exactly.
      return {
        status: 'DUPLICATE',
        reasons: ['No reference available on either record; normalized title/organization/deadline fingerprint matches exactly.'],
        matchedRecordId: fingerprintMatch.record.id,
        incomingReferenceNormalized: incomingRefNorm,
        incomingFingerprint
      };
    }

    if (!incomingRefNorm || !existingRefNorm) {
      // One side has a reference, the other doesn't, but fingerprint matches exactly.
      return {
        status: 'DUPLICATE',
        reasons: ['Fingerprint (title/organization/deadline) matches exactly; only one side has a reference number on record.'],
        matchedRecordId: fingerprintMatch.record.id,
        incomingReferenceNormalized: incomingRefNorm,
        incomingFingerprint
      };
    }

    // Both have references, but they're different, and fingerprint still matches exactly.
    // This is suspicious enough to flag, but not confident enough to auto-merge.
    return {
      status: 'POSSIBLE_DUPLICATE',
      reasons: ['Title/organization/deadline fingerprint matches an existing record exactly, but the two records carry different reference numbers.'],
      matchedRecordId: fingerprintMatch.record.id,
      incomingReferenceNormalized: incomingRefNorm,
      incomingFingerprint
    };
  }

  // Step 4 — no exact fingerprint match either. Check for a near-match title
  // (same organization + same deadline, similar-but-not-identical title) so
  // genuine wording variations of the same tender are never silently marked NEW.
  const sameOrgAndDeadline = enrichedExisting.filter(e => {
    const org = cleanText(e.record.organization);
    const deadline = normalizeDeadline(e.record.deadline);
    return org === cleanText(incoming.organization) && deadline === normalizeDeadline(incoming.deadline);
  });

  for (const candidate of sameOrgAndDeadline) {
    const similarity = titleSimilarity(incoming.title, candidate.record.title);
    if (similarity >= NEAR_MATCH_THRESHOLD && similarity < 1) {
      return {
        status: 'POSSIBLE_DUPLICATE',
        reasons: ['Same organization and deadline as an existing record, with a very similar (but not identical) title (similarity ' +
          similarity.toFixed(2) + '). Needs human review before treating as new or duplicate.'],
        matchedRecordId: candidate.record.id,
        incomingReferenceNormalized: incomingRefNorm,
        incomingFingerprint
      };
    }
  }

  // Step 5 — genuinely new.
  return {
    status: 'NEW',
    reasons: ['No matching reference, no matching fingerprint, and no near-match title found against existing records.'],
    matchedRecordId: null,
    incomingReferenceNormalized: incomingRefNorm,
    incomingFingerprint
  };
}

module.exports = {
  normalizeReference,
  normalizeDeadline,
  generateFingerprint,
  titleSimilarity,
  checkDuplicate,
  NEAR_MATCH_THRESHOLD
};
