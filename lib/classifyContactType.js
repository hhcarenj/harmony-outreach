// Heuristic classifier for sc_contacts.contact_type.
//
// Prior to this, no shared classification function existed — contact_type was
// assigned manually in one-off import scripts. This centralizes the logic so the
// dashboard and any future import scripts classify consistently.
//
// IMPORTANT: pediatric keywords are checked BEFORE the general doctors_office
// keywords, so a pediatric practice never falls through to doctors_office.

const PEDIATRIC_KEYWORDS = [
  "pediatric",      // also matches "pediatrics"
  "children's",
  "childrens",
  "kids",
  "adolescent medicine",
];

const DOCTORS_OFFICE_KEYWORDS = [
  " md",
  " do ",
  "physician",
  "medical group",
  "family practice",
  "family medicine",
  "primary care",
  "internal medicine",
  "medical associates",
];

// Returns one of the contact_type enum values, or null if nothing matches.
export function classifyContactType({ agency_name, organization, website, notes } = {}) {
  const haystack = [agency_name, organization, website, notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return null;

  // 1) Pediatric first — highest priority so peds practices don't become doctors_office.
  if (PEDIATRIC_KEYWORDS.some((kw) => haystack.includes(kw))) {
    return "pediatric_practice";
  }

  // 2) General doctor's office heuristic.
  if (DOCTORS_OFFICE_KEYWORDS.some((kw) => haystack.includes(kw))) {
    return "doctors_office";
  }

  return null;
}

export { PEDIATRIC_KEYWORDS, DOCTORS_OFFICE_KEYWORDS };
