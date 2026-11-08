/** Lower-cased text the list search matches against. SQLite's LIKE is case-blind only for ASCII, so Cyrillic is folded here. */
export const searchText = (l: { name: string; email: string; phone: string }) =>
  `${l.name} ${l.email} ${l.phone.replace(/\D/g, "")}`.toLowerCase();

/** Turns a user's query into the same folded form: words stay, phone punctuation goes. */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => (/^[+\d()-]+$/.test(t) ? t.replace(/\D/g, "") : t))
    .filter(Boolean);
}
