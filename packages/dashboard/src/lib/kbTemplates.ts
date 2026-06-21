// Mirror of packages/api/src/lib/kbTemplates.ts — kept in the dashboard so KB
// creation forms can show the type-appropriate description as placeholder
// text. The backend remains the source of truth for what gets persisted.

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
