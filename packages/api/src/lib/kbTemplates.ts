// KB description templates — ported verbatim from the reference's
// lib/kbTemplates.ts. Seeds an empty description on a freshly-created KB based
// on its type so the AI has something specific to match future conversations
// against. The AI or user can override by passing a description explicitly.

export interface KbTemplate {
  description: string;
  suggestedTags: string[];
}

export const KB_TEMPLATES: Record<string, KbTemplate> = {
  software: {
    description:
      "Software project — architecture decisions, tech stack, conventions, implementation state, and open technical questions.",
    suggestedTags: ["architecture", "tech-stack", "conventions", "implementation"],
  },
  research: {
    description:
      "Research project — thesis/hypothesis, methodology, sources reviewed, key findings, and open questions.",
    suggestedTags: ["methodology", "findings", "sources", "hypothesis"],
  },
  business: {
    description:
      "Business engagement — strategy decisions, market analysis, client context, deliverables, and action items.",
    suggestedTags: ["strategy", "analysis", "deliverables", "client"],
  },
  course: {
    description:
      "Course study — topics covered, concepts understood, areas of difficulty, study strategies, and exam prep.",
    suggestedTags: ["topics", "concepts", "study-strategies", "assignments"],
  },
  general: {
    description: "General knowledge collection.",
    suggestedTags: [],
  },
};

export function templateFor(kbType: string | null | undefined): KbTemplate {
  if (!kbType) return KB_TEMPLATES.general;
  return KB_TEMPLATES[kbType] ?? KB_TEMPLATES.general;
}

export function descriptionForNewKb(
  kbType: string | null | undefined,
  providedDescription: string | null | undefined
): string {
  const trimmed = typeof providedDescription === "string" ? providedDescription.trim() : "";
  if (trimmed.length > 0) return trimmed;
  return templateFor(kbType).description;
}
