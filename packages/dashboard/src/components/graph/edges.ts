import type { KnowledgeBase } from "../../lib/types";

export interface DerivedEdge {
  a: string;
  b: string;
  strength: number;
  tags: string[];
}

// Derive edges from shared topic_tags. Two KBs are connected if they share at
// least one tag; strength is Jaccard similarity (|A∩B| / |A∪B|).
export function deriveEdges(kbs: KnowledgeBase[]): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  for (let i = 0; i < kbs.length; i++) {
    const a = kbs[i];
    const aTags = new Set(a.topic_tags ?? []);
    if (aTags.size === 0) continue;
    for (let j = i + 1; j < kbs.length; j++) {
      const b = kbs[j];
      const bTags = b.topic_tags ?? [];
      const shared: string[] = [];
      for (const t of bTags) if (aTags.has(t)) shared.push(t);
      if (shared.length === 0) continue;
      const union = new Set([...aTags, ...bTags]).size;
      const strength = Math.min(1, shared.length / union);
      edges.push({ a: a.id, b: b.id, strength, tags: shared });
    }
  }
  return edges;
}

// Recency in [0,1]: 1.0 = today, ~0 = >30 days. Used for halo opacity.
export function recencyOf(updatedAt: string): number {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return 0.3;
  const days = (Date.now() - updated) / (1000 * 60 * 60 * 24);
  return Math.max(0.15, Math.min(1, 1 - days / 30));
}
