/**
 * TenderAlert — Sector & Location Normalization Module
 *
 * Standalone, reusable module intended to sit here in the future pipeline:
 *   SOURCE -> NORMALIZATION -> VALIDATION -> DEDUPLICATION -> AI ENRICHMENT -> SUPABASE
 *
 * This module does NOT touch Supabase, the dashboard, or any live source.
 * It is pure logic + a local test suite, meant to be reviewed before wiring in.
 *
 * Rules are deterministic (no AI). Anything ambiguous or unknown is routed to
 * manual review rather than guessed.
 */

'use strict';

/* ============================================================
   SECTOR NORMALIZATION
   ============================================================ */

const SECTORS = ['Construction', 'Supplies', 'IT', 'Consultancy', 'Medical', 'Agriculture'];

// Domain-specific keyword sets. Order matters for disambiguation:
// domain-specific sectors (Medical, Agriculture, Construction, IT, Consultancy)
// are checked BEFORE the generic "Supplies" bucket, so a domain term always
// overrides a generic "supplies" mention (e.g. "Health Supplies" -> Medical).
const SECTOR_KEYWORDS = {
  Construction: [
    'building', 'civil works', 'roads', 'bridges', 'drainage',
    'construction', 'renovation'
  ],
  IT: [
    'ict', 'information technology', 'software', 'networking',
    'computer', 'systems'
  ],
  Consultancy: [
    'consultancy', 'advisory', 'study', 'review', 'technical assistance',
    'audit services'
  ],
  Medical: [
    'health', 'hospital', 'pharmaceutical', 'pharmaceuticals',
    'medical equipment', 'medical', 'clinical'
  ],
  Agriculture: [
    'farm input', 'farm inputs', 'seeds', 'agro', 'livestock', 'agricultural'
  ],
  // Generic bucket — only wins if nothing above matched.
  Supplies: [
    'supply of goods', 'procurement of materials', 'stationery',
    'general supplies', 'equipment supply', 'supplies', 'supply'
  ]
};

// Order in which we check sectors: domain-specific first, Supplies last.
const SECTOR_CHECK_ORDER = ['Construction', 'IT', 'Consultancy', 'Medical', 'Agriculture', 'Supplies'];

// Weak/generic words that, on their own, are too vague to confidently assign
// a sector — but when found ALONGSIDE a generic "Supplies" match, they signal
// a genuinely mixed/ambiguous phrase (e.g. "Mixed Works & Supplies") that
// should go to manual review rather than default to Supplies.
const SECTOR_WEAK_KEYWORDS = {
  Construction: ['works']
};

function cleanText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[\/&,.\-_()]+/g, ' ')   // punctuation -> space
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

function matchesKeyword(cleaned, keyword) {
  // Whole-phrase substring match on cleaned (punctuation-stripped) text.
  return cleaned.includes(keyword);
}

/**
 * normalizeSector(rawSector) -> {
 *   normalized: string|null,
 *   manualReviewRequired: boolean,
 *   reason: string|null
 * }
 */
function normalizeSector(rawSector) {
  const cleaned = cleanText(rawSector);

  if (!cleaned) {
    return {
      normalized: null,
      manualReviewRequired: true,
      reason: 'Sector is missing/empty'
    };
  }

  const matchedSectors = [];

  for (const sector of SECTOR_CHECK_ORDER) {
    const keywords = SECTOR_KEYWORDS[sector];
    const hit = keywords.some(kw => matchesKeyword(cleaned, kw));
    if (hit) matchedSectors.push(sector);
  }

  // Disambiguation rule: if Supplies matched alongside a domain-specific
  // sector, the domain-specific sector wins (Supplies is dropped).
  if (matchedSectors.length > 1 && matchedSectors.includes('Supplies')) {
    const domainMatches = matchedSectors.filter(s => s !== 'Supplies');
    if (domainMatches.length === 1) {
      return {
        normalized: domainMatches[0],
        manualReviewRequired: false,
        reason: null
      };
    }
    // Multiple domain sectors AND Supplies matched -> genuinely ambiguous.
    return {
      normalized: null,
      manualReviewRequired: true,
      reason: 'Matches multiple unrelated sectors: ' + matchedSectors.join(', ')
    };
  }

  if (matchedSectors.length === 1) {
    // If the only strong match is the generic "Supplies" bucket, check for a
    // weak/generic word belonging to another sector (e.g. "works") — that
    // combination signals a genuinely mixed phrase, not a confident Supplies match.
    if (matchedSectors[0] === 'Supplies') {
      const conflictingWeakSectors = Object.keys(SECTOR_WEAK_KEYWORDS).filter(sector =>
        SECTOR_WEAK_KEYWORDS[sector].some(kw => matchesKeyword(cleaned, kw))
      );
      if (conflictingWeakSectors.length > 0) {
        return {
          normalized: null,
          manualReviewRequired: true,
          reason: 'Ambiguous mixed phrase: generic "Supplies" match alongside ' +
            conflictingWeakSectors.join(', ') + '-related wording'
        };
      }
    }

    return {
      normalized: matchedSectors[0],
      manualReviewRequired: false,
      reason: null
    };
  }

  if (matchedSectors.length > 1) {
    // Multiple domain-specific sectors matched, no Supplies involved.
    return {
      normalized: null,
      manualReviewRequired: true,
      reason: 'Matches multiple unrelated sectors: ' + matchedSectors.join(', ')
    };
  }

  // No matches at all.
  return {
    normalized: null,
    manualReviewRequired: true,
    reason: 'No known sector keywords matched: "' + rawSector + '"'
  };
}

/* ============================================================
   LOCATION NORMALIZATION
   ============================================================ */

// Known aliases only — NOT a closed district list. Anything not present
// here is sent to manual review rather than guessed or rejected.
const LOCATION_ALIASES = {
  'kampala': 'Kampala',
  'kla': 'Kampala',
  'kla city': 'Kampala',
  'jinja': 'Jinja',
  'jinja city': 'Jinja',
  'jinja municipality': 'Jinja'
};

/**
 * normalizeLocation(rawLocation) -> {
 *   normalized: string|null,
 *   manualReviewRequired: boolean,
 *   reason: string|null
 * }
 */
function normalizeLocation(rawLocation) {
  const cleaned = cleanText(rawLocation);

  if (!cleaned) {
    // Missing location is allowed to remain blank/null — does not block processing.
    return {
      normalized: null,
      manualReviewRequired: false,
      reason: null
    };
  }

  if (Object.prototype.hasOwnProperty.call(LOCATION_ALIASES, cleaned)) {
    return {
      normalized: LOCATION_ALIASES[cleaned],
      manualReviewRequired: false,
      reason: null
    };
  }

  // Not found in the known-alias table -> do not guess.
  return {
    normalized: null,
    manualReviewRequired: true,
    reason: 'Location not recognized in known alias table: "' + rawLocation + '"'
  };
}

/* ============================================================
   COMBINED OUTPUT
   ============================================================ */

/**
 * normalizeTenderFields({ sector, location }) -> {
 *   normalizedSector: string|null,
 *   normalizedLocation: string|null,
 *   manualReviewRequired: boolean,
 *   reasons: string[],
 *   rawSector: any,
 *   rawLocation: any
 * }
 */
function normalizeTenderFields({ sector, location } = {}) {
  const sectorResult = normalizeSector(sector);
  const locationResult = normalizeLocation(location);

  const reasons = [];
  if (sectorResult.manualReviewRequired) reasons.push('SECTOR: ' + sectorResult.reason);
  if (locationResult.manualReviewRequired) reasons.push('LOCATION: ' + locationResult.reason);

  return {
    normalizedSector: sectorResult.normalized,
    normalizedLocation: locationResult.normalized,
    manualReviewRequired: sectorResult.manualReviewRequired || locationResult.manualReviewRequired,
    reasons,
    rawSector: sector === undefined ? null : sector,
    rawLocation: location === undefined ? null : location
  };
}

module.exports = {
  SECTORS,
  normalizeSector,
  normalizeLocation,
  normalizeTenderFields
};
