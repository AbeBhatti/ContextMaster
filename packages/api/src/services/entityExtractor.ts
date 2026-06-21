// Server-side regex NER + coverage verification for session summaries.
// Ported verbatim from the reference's services/entityExtractor.ts — pure
// regex / substring work, no LLM calls, no embeddings, so it transfers 1:1.
//
// The save_memory extraction prompt asks the consuming AI to put every proper
// noun, number, URL, and identifier in the session_summary as a "safety net"
// against detail loss. This module checks whether those entities actually
// appear in the extracted chunks; for any that don't, the commit handler
// creates a supplementary "reference" chunk so the fact remains recallable.

export type EntityCategory =
  | "proper_noun"
  | "number"
  | "url"
  | "technical_id"
  | "quoted_text";

export interface ExtractedEntity {
  text: string;
  category: EntityCategory;
  sentence: string;
}

export interface CoverageGap {
  entity: ExtractedEntity;
}

export interface SupplementaryChunk {
  content: string;
  chunk_type: "reference";
  topic_tags: string[];
}

const PROPER_NOUN_SKIP = new Set<string>([
  "The", "This", "That", "These", "Those", "There", "Their", "They",
  "However", "Also", "But", "And", "Or", "Nor", "Yet", "So",
  "Session", "Decision", "Finding", "Reference", "State", "Context",
  "Update", "First", "Next", "Then", "Now", "Today", "Tomorrow",
  "When", "Where", "What", "Why", "Who", "How", "Which",
  "If", "Else", "While", "After", "Before", "During", "Until",
  "Add", "Added", "Adding", "Remove", "Removed", "Removing",
  "Change", "Changed", "Changing", "Use", "Used", "Using",
  "Note", "Notes", "Summary", "Details", "Goal", "Goals",
  "Step", "Steps", "Plan", "Plans", "Task", "Tasks",
  "Pass", "Passed", "Failed", "Fix", "Fixed", "Fixing",
  "Open", "Closed", "New", "Old", "Current",
  "All", "Some", "Many", "Few", "Most", "Each", "Every",
  "Both", "Either", "Neither", "Same", "Different",
  "True", "False", "Yes", "No", "Maybe",
  "Production", "Staging", "Development", "Local",
]);

const URL_FULL_RE = /https?:\/\/[^\s,)"']+/gi;
const URL_DOMAIN_RE = /[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/[^\s,)"']*)?/gi;

const NUMBER_PORT_RE = /(?:port\s+)\d+/gi;
const NUMBER_VERSION_RE = /\bv\d+\.\d+(?:\.\d+)?/gi;
const NUMBER_PRICE_RE = /\$[\d,]+(?:\.\d{2})?/gi;
const NUMBER_UNIT_RE =
  /\b\d+(?:\.\d+)?\s*(?:ms|px|rem|GB|MB|KB|tokens?|chunks?|%)\b/gi;

const TECH_ENV_RE = /[A-Z][A-Z0-9_]{2,}(?:_[A-Z0-9]+)*/g;
const TECH_PATH_RE = /\/[a-z][a-z0-9\/-]+/g;
const TECH_REGION_RE = /[a-z]+-[a-z]+-\d[a-z0-9-]*/g;

const QUOTED_DOUBLE_RE = /"([^"]{3,80})"/g;
const QUOTED_SINGLE_RE = /'([^']{3,80})'/g;

const PROPER_NOUN_RE =
  /(?<!^)(?<![.!?]\s+)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gm;

export function splitIntoSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/g);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function pushMatches(
  out: ExtractedEntity[],
  re: RegExp,
  sentence: string,
  category: EntityCategory,
  groupIdx = 0
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const text = (m[groupIdx] ?? m[0]).trim();
    if (!text) continue;
    out.push({ text, category, sentence });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
}

export function extractEntities(text: string): ExtractedEntity[] {
  if (!text || !text.trim()) return [];
  const sentences = splitIntoSentences(text);
  const out: ExtractedEntity[] = [];

  for (const sentence of sentences) {
    pushMatches(out, URL_FULL_RE, sentence, "url");
    pushMatches(out, URL_DOMAIN_RE, sentence, "url");

    pushMatches(out, NUMBER_PORT_RE, sentence, "number");
    pushMatches(out, NUMBER_VERSION_RE, sentence, "number");
    pushMatches(out, NUMBER_PRICE_RE, sentence, "number");
    pushMatches(out, NUMBER_UNIT_RE, sentence, "number");

    pushMatches(out, TECH_ENV_RE, sentence, "technical_id");
    pushMatches(out, TECH_PATH_RE, sentence, "technical_id");
    pushMatches(out, TECH_REGION_RE, sentence, "technical_id");

    pushMatches(out, QUOTED_DOUBLE_RE, sentence, "quoted_text", 1);
    pushMatches(out, QUOTED_SINGLE_RE, sentence, "quoted_text", 1);

    PROPER_NOUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROPER_NOUN_RE.exec(sentence)) !== null) {
      const matched = (m[1] ?? m[0]).trim();
      if (!matched) continue;
      const firstWord = matched.split(/\s+/)[0];
      if (PROPER_NOUN_SKIP.has(firstWord)) {
        if (m.index === PROPER_NOUN_RE.lastIndex) PROPER_NOUN_RE.lastIndex++;
        continue;
      }
      out.push({ text: matched, category: "proper_noun", sentence });
      if (m.index === PROPER_NOUN_RE.lastIndex) PROPER_NOUN_RE.lastIndex++;
    }
  }

  const seen = new Set<string>();
  const deduped: ExtractedEntity[] = [];
  for (const e of out) {
    const key = `${e.category}:${e.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}

export function checkCoverage(
  summaryEntities: ExtractedEntity[],
  chunks: Array<{ content: string }>
): CoverageGap[] {
  const haystack = chunks.map((c) => c.content).join("\n\n").toLowerCase();
  const gaps: CoverageGap[] = [];
  for (const entity of summaryEntities) {
    const needle = entity.text.toLowerCase();
    if (!haystack.includes(needle)) {
      gaps.push({ entity });
    }
  }
  return gaps;
}

export function generateSupplementaryChunks(
  gaps: CoverageGap[],
  datePrefix: string
): SupplementaryChunk[] {
  if (gaps.length === 0) return [];

  const bySentence = new Map<string, CoverageGap[]>();
  for (const g of gaps) {
    const key = g.entity.sentence;
    const list = bySentence.get(key) ?? [];
    list.push(g);
    bySentence.set(key, list);
  }

  const out: SupplementaryChunk[] = [];
  for (const [sentence, sentenceGaps] of bySentence.entries()) {
    const categories = Array.from(new Set(sentenceGaps.map((g) => g.entity.category)));
    out.push({
      content: datePrefix + sentence,
      chunk_type: "reference",
      topic_tags: ["coverage-gap", ...categories],
    });
  }
  return out;
}
