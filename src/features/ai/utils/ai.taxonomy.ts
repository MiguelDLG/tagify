import type { TagTaxonomy } from "@/types/tagData";
import type { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

export function tagPath(taxonomy: TagTaxonomy, tagId: string): string {
  const tag = taxonomy.tagsById[tagId];
  if (!tag) return tagId;
  const sub = taxonomy.subcategoriesById[tag.subcategoryId];
  const cat = sub ? taxonomy.categoriesById[sub.categoryId] : undefined;
  return [cat?.name, sub?.name, tag.name].filter(Boolean).join(" › ");
}

export function tagName(taxonomy: TagTaxonomy, tagId: string): string {
  return taxonomy.tagsById[tagId]?.name ?? tagId;
}

/** One line per tag, grouped in taxonomy order, for the system prompt. */
export function renderTaxonomy(taxonomy: TagTaxonomy): string {
  const lines: string[] = [];
  for (const catId of taxonomy.categoryOrder) {
    const cat = taxonomy.categoriesById[catId];
    if (!cat) continue;
    for (const subId of cat.subcategoryIds) {
      const sub = taxonomy.subcategoriesById[subId];
      if (!sub) continue;
      lines.push(`[${subId}] ${cat.name} › ${sub.name}`);
      for (const tagId of sub.tagIds) {
        const tag = taxonomy.tagsById[tagId];
        if (tag) lines.push(`  ${tagId}: ${tag.name}`);
      }
    }
  }
  return lines.join("\n");
}

/** Human-readable smart playlist rule, e.g. "(Rap AND Atmospheric) · energy ≥ 7". */
export function describeCriteria(
  criteria: SmartPlaylistFilterCriteria,
  taxonomy: TagTaxonomy,
): string {
  const clauses = (criteria.includeTagClauses || []).map((clause) => {
    const inc = clause.tagIds.map((id) => tagName(taxonomy, id));
    const exc = clause.excludedTagIds.map((id) => `NOT ${tagName(taxonomy, id)}`);
    const parts = [...inc, ...exc];
    return parts.length > 1 ? `(${parts.join(` ${clause.operator} `)})` : parts[0] ?? "";
  });
  let text = clauses
    .map((c, i) => (i === 0 ? c : `${criteria.clauseConnectors?.[i - 1] ?? "AND"} ${c}`))
    .join(" ");
  const extras: string[] = [];
  if (criteria.ratingFilters?.length) extras.push(`rating in [${criteria.ratingFilters.join(", ")}]`);
  if (criteria.energyMinFilter !== null && criteria.energyMinFilter !== undefined) extras.push(`energy ≥ ${criteria.energyMinFilter}`);
  if (criteria.energyMaxFilter !== null && criteria.energyMaxFilter !== undefined) extras.push(`energy ≤ ${criteria.energyMaxFilter}`);
  if (criteria.bpmMinFilter !== null && criteria.bpmMinFilter !== undefined) extras.push(`bpm ≥ ${criteria.bpmMinFilter}`);
  if (criteria.bpmMaxFilter !== null && criteria.bpmMaxFilter !== undefined) extras.push(`bpm ≤ ${criteria.bpmMaxFilter}`);
  if (criteria.camelotKeyFilters?.length) extras.push(`key in [${criteria.camelotKeyFilters.join(", ")}]`);
  if (extras.length) text = [text, ...extras].filter(Boolean).join(" · ");
  return text || "(no rules)";
}
