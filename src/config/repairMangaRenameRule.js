/**
 * Swaps the pre-6.4.7 `mangaRenameRule` default, whose stray `}` ended every
 * manga name, for the corrected one. Any other rule is the user's own and is
 * returned unchanged.
 */
export default function repairMangaRenameRule(rule) {
  return rule === '{id}_{title}}' ? '{id}_{title}' : rule;
}
