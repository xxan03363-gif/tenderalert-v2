/**
 * TenderAlert — Tender Validation Module
 *
 * Standalone, reusable module intended to sit here in the future pipeline:
 *   SOURCE -> NORMALIZATION -> VALIDATION -> DEDUPLICATION -> AI ENRICHMENT -> SUPABASE
 *
 * This module does NOT touch Supabase, the dashboard, or any live source.
 * It is pure logic + a local test suite, meant to be reviewed before wiring in.
 *
 * Design principles:
 *  - Deterministic. No AI, no guessing.
 *  - Never invents missing data (no fabricated titles, orgs, dates, sectors).
 *  - Never silently discards a record — every record gets a clear status
 *    and a list of reasons.
 *  - Treats every incoming field as untrusted text — never evaluated,
 *    executed, or interpreted as anything other than a plain string/number.
 */

'use strict';

const { SECTORS } = require('./normalization');

/* ============================================================
   SHARED HELPERS
   ============================================================ */

function toPlainString(value) {
  // Defensive: never trust incoming data to already be a safe string.
  if (value === null || value === undefined) return '';
  return String(value);
}

function isBlank(value) {
  return toPlainString(value).trim() === '';
}

function looksLikePlaceholder(value) {
  const v = toPlainString(value).trim().toLowerCase();
  return /^(n\/?a|tbd|test|xxx+|\.+|-+|none|unknown)$/.test(v);
}

function isMeaninglessSymbolsOnly(value) {
  const v = toPlainString(value).trim();
  return v.length > 0 && !/[a-z0-9]/i.test(v);
}

/* ============================================================
   DEADLINE PARSING (strict, deterministic)
   ============================================================
   Accepted input contract: ISO 8601 date ("YYYY-MM-DD") or
   ISO 8601 datetime ("YYYY-MM-DDTHH:mm:ss[.sss](Z|+HH:mm)").
   This assumes the ingestion/source-mapping step has already converted
   whatever raw format the source provides into ISO 8601 before reaching
   validation — flagged in the report as an assumption to confirm.
*/

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const PLAUSIBLE_YEAR_MIN = 2000;
const PLAUSIBLE_YEAR_MAX = 2100;

function daysInMonth(year, month) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const days = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/**
 * parseDeadline(raw) -> {
 *   valid: boolean,
 *   reason: string|null,
 *   dateOnly: string|null,      // "YYYY-MM-DD"
 *   utcMillis: number|null
 * }
 */
function parseDeadline(raw) {
  if (isBlank(raw)) {
    return { valid: false, reason: 'Deadline is missing', dateOnly: null, utcMillis: null };
  }

  const value = toPlainString(raw).trim();
  let match = value.match(DATE_ONLY_RE) || value.match(DATETIME_RE);

  if (!match) {
    return {
      valid: false,
      reason: 'Deadline is not in an accepted ISO 8601 date/datetime format: "' + value + '"',
      dateOnly: null,
      utcMillis: null
    };
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = match[4] ? parseInt(match[4], 10) : 0;
  const minute = match[5] ? parseInt(match[5], 10) : 0;
  const second = match[6] ? parseInt(match[6], 10) : 0;

  if (month < 1 || month > 12) {
    return { valid: false, reason: 'Deadline has an impossible month: ' + month, dateOnly: null, utcMillis: null };
  }

  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    return {
      valid: false,
      reason: 'Deadline has an impossible day-of-month: ' + value + ' (month ' + month + ' only has ' + maxDay + ' days)',
      dateOnly: null,
      utcMillis: null
    };
  }

  if (year < PLAUSIBLE_YEAR_MIN || year > PLAUSIBLE_YEAR_MAX) {
    return {
      valid: false,
      reason: 'Deadline year (' + year + ') is outside the plausible range ' + PLAUSIBLE_YEAR_MIN + '-' + PLAUSIBLE_YEAR_MAX,
      dateOnly: null,
      utcMillis: null
    };
  }

  if (hour > 23 || minute > 59 || second > 59) {
    return { valid: false, reason: 'Deadline has an impossible time component: ' + value, dateOnly: null, utcMillis: null };
  }

  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const dateOnly = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

  return { valid: true, reason: null, dateOnly, utcMillis };
}

/* ============================================================
   UGANDA TIME (EAT, UTC+3, no DST)
   ============================================================
   Uganda does not observe daylight saving, so the offset is a fixed +3
   hours year-round. This is used ONLY for "is this deadline expired as of
   right now, in Uganda's local calendar date" business logic — it does not
   imply anything about how timestamps should be stored in the database.
   Standard practice (and Supabase's default) is to store timestamps in UTC
   and convert to local time only for display/comparison logic like this.
*/

const UGANDA_UTC_OFFSET_HOURS = 3;

function ugandaNowDateOnly() {
  const nowUtcMillis = Date.now();
  const ugandaMillis = nowUtcMillis + UGANDA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const d = new Date(ugandaMillis);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function isExpired(deadlineDateOnly) {
  if (!deadlineDateOnly) return null;
  // A tender is considered still open through the entirety of its deadline day.
  return ugandaNowDateOnly() > deadlineDateOnly;
}

const FAR_FUTURE_YEARS_WARNING = 3;

function isUnusuallyFarFuture(deadlineDateOnly) {
  if (!deadlineDateOnly) return false;
  const deadlineYear = parseInt(deadlineDateOnly.slice(0, 4), 10);
  const currentYear = new Date().getUTCFullYear();
  return deadlineYear - currentYear > FAR_FUTURE_YEARS_WARNING;
}

/* ============================================================
   FIELD-LEVEL VALIDATORS
   Each returns { severity: null|'WARNING'|'REVIEW'|'CRITICAL', message: string|null }
   severity === null means "passed cleanly".
   ============================================================ */

function validateTitle(title) {
  if (isBlank(title)) {
    return { severity: 'CRITICAL', message: 'Title is missing, empty, or whitespace-only' };
  }
  if (looksLikePlaceholder(title)) {
    return { severity: 'REVIEW', message: 'Title looks like a placeholder value ("' + title + '") rather than a real tender title' };
  }
  return { severity: null, message: null };
}

function validateSector(sector) {
  if (isBlank(sector)) {
    return { severity: 'REVIEW', message: 'Sector is missing — needs manual classification before this tender can continue' };
  }
  if (!SECTORS.includes(sector)) {
    return { severity: 'REVIEW', message: 'Sector "' + sector + '" is not one of the six recognized TenderAlert sectors — needs manual classification' };
  }
  return { severity: null, message: null };
}

function validateOrganization(organization) {
  if (isBlank(organization)) {
    return { severity: 'CRITICAL', message: 'Organization is missing, empty, or whitespace-only' };
  }
  if (looksLikePlaceholder(organization)) {
    return { severity: 'REVIEW', message: 'Organization looks like a placeholder value ("' + organization + '") rather than a real entity name' };
  }
  return { severity: null, message: null };
}

function validateDeadlineField(deadline) {
  const parsed = parseDeadline(deadline);

  if (!parsed.valid) {
    return { severity: 'CRITICAL', message: parsed.reason, parsed };
  }

  const expired = isExpired(parsed.dateOnly);
  const farFuture = isUnusuallyFarFuture(parsed.dateOnly);

  if (expired) {
    return {
      severity: 'WARNING',
      message: 'Deadline (' + parsed.dateOnly + ') has already passed — record can still continue, marked expired',
      parsed,
      isExpired: true
    };
  }

  if (farFuture) {
    return {
      severity: 'WARNING',
      message: 'Deadline (' + parsed.dateOnly + ') is unusually far in the future — please verify',
      parsed,
      isExpired: false
    };
  }

  return { severity: null, message: null, parsed, isExpired: false };
}

function validateReference(reference) {
  if (isBlank(reference)) {
    return { severity: null, message: 'No reference provided (allowed — reference is optional)' };
  }

  const trimmed = toPlainString(reference).trim();

  if (isMeaninglessSymbolsOnly(trimmed) || trimmed.length < 2) {
    return { severity: 'REVIEW', message: 'Reference is present but appears meaningless/malformed: "' + trimmed + '"' };
  }

  // Unusual-but-plausible formatting (mixed symbols/alphanumerics, longer strings)
  // is allowed through but flagged for awareness, not blocked.
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(trimmed)) {
    return { severity: 'WARNING', message: 'Reference has an unusual format: "' + trimmed + '" — allowed, but worth a glance' };
  }

  return { severity: null, message: null };
}

function validateLocation(location) {
  if (isBlank(location)) {
    return { severity: null, message: 'No location provided (allowed — location is optional)' };
  }

  const trimmed = toPlainString(location).trim();

  if (isMeaninglessSymbolsOnly(trimmed) || trimmed.length < 2) {
    return { severity: 'REVIEW', message: 'Location is present but appears meaningless: "' + trimmed + '"' };
  }

  return { severity: null, message: null };
}

function validateMatchPercentage(value) {
  if (value === null || value === undefined || value === '') {
    return { severity: null, message: 'match_percentage not supplied (expected — computed per-subscriber later)' };
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return { severity: 'CRITICAL', message: 'match_percentage supplied but not a valid number between 0 and 100: "' + value + '"' };
  }

  return { severity: null, message: null };
}

function validateListField(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { severity: null, message: fieldName + ' not supplied yet (allowed — may be generated later by AI enrichment)' };
  }

  if (Array.isArray(value)) {
    const allStrings = value.every(item => typeof item === 'string');
    if (!allStrings) {
      return { severity: 'CRITICAL', message: fieldName + ' is an array but contains non-string entries' };
    }
    return { severity: null, message: null };
  }

  if (typeof value === 'string') {
    return { severity: null, message: null };
  }

  return { severity: 'CRITICAL', message: fieldName + ' has an unsupported structure (expected array of strings or a string, got ' + typeof value + ')' };
}

function validateFreeTextField(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { severity: null, message: fieldName + ' not supplied yet (allowed — may be generated later by AI enrichment)' };
  }
  if (typeof value !== 'string') {
    return { severity: 'WARNING', message: fieldName + ' has an unexpected type (' + typeof value + '), expected text' };
  }
  return { severity: null, message: null };
}

/* ============================================================
   TOP-LEVEL VALIDATION
   ============================================================
   validateTender(tender) -> {
     status: 'VALID' | 'INVALID' | 'REVIEW',
     canContinue: boolean,
     requiresManualReview: boolean,
     isExpired: boolean|null,
     fields: { ...per-field results... },
     reasons: string[]   // every non-clean message, in field order
   }

   Expected input shape (post-normalization values expected for sector/location).
   Field names match the approved Tenders schema / shared pipeline contract:
   { title, sector, organization, location, deadline, reference,
     match_percentage, summary, buyer_wants, eligibility, requirements, documents }
*/

function validateTender(tender) {
  tender = tender || {};

  const fields = {
    title: validateTitle(tender.title),
    sector: validateSector(tender.sector),
    organization: validateOrganization(tender.organization),
    deadline: validateDeadlineField(tender.deadline),
    reference: validateReference(tender.reference),
    location: validateLocation(tender.location),
    match_percentage: validateMatchPercentage(tender.match_percentage),
    requirements: validateListField(tender.requirements, 'requirements'),
    documents: validateListField(tender.documents, 'documents'),
    summary: validateFreeTextField(tender.summary, 'summary'),
    buyer_wants: validateFreeTextField(tender.buyer_wants, 'buyer_wants'),
    eligibility: validateFreeTextField(tender.eligibility, 'eligibility')
  };

  const reasons = [];
  let highestSeverity = null; // null < WARNING < REVIEW < CRITICAL (in blocking terms)

  const severityRank = { WARNING: 1, REVIEW: 2, CRITICAL: 3 };

  Object.keys(fields).forEach(key => {
    const result = fields[key];
    if (result.severity) {
      reasons.push('[' + result.severity + '] ' + key + ': ' + result.message);
      if (!highestSeverity || severityRank[result.severity] > severityRank[highestSeverity]) {
        highestSeverity = result.severity;
      }
    }
  });

  let status, canContinue, requiresManualReview;

  if (highestSeverity === 'CRITICAL') {
    status = 'INVALID';
    canContinue = false;
    requiresManualReview = false;
  } else if (highestSeverity === 'REVIEW') {
    status = 'REVIEW';
    canContinue = false;
    requiresManualReview = true;
  } else {
    status = 'VALID';
    canContinue = true;
    requiresManualReview = false;
  }

  return {
    status,
    canContinue,
    requiresManualReview,
    isExpired: fields.deadline.isExpired !== undefined ? fields.deadline.isExpired : null,
    fields,
    reasons
  };
}

module.exports = {
  validateTender,
  parseDeadline,
  isExpired,
  ugandaNowDateOnly,
  PLAUSIBLE_YEAR_MIN,
  PLAUSIBLE_YEAR_MAX,
  FAR_FUTURE_YEARS_WARNING
};
