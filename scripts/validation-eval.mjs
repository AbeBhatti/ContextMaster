#!/usr/bin/env node
/**
 * ContextMaster — held-out VALIDATION eval (Redis port of the reference's
 * scripts/validation-eval.mjs).
 *
 * Same held-out corpus (27 chunks across kitchen / game / legal), same 35
 * hand-labeled queries, same scoring — but seeds into Redis and retrieves
 * through ContextMaster's ported hybridRecall (RRF of vector + BM25 with
 * chunk-type intent, K=8). Proves the retrieval engine matches the reference's
 * behaviour: recall should stay ~1.000 with the same precision ballpark.
 *
 * Usage:  node scripts/validation-eval.mjs
 * Requires: API built (pnpm --filter @contextmaster/api build), Redis up,
 *           OPENAI_API_KEY in .env.
 */
import "../packages/api/dist/loadEnv.js";

const dist = "../packages/api/dist";
const { getRedis, connectRedis } = await import(`${dist}/lib/redis.js`);
const { generateEmbeddings } = await import(`${dist}/services/embeddingService.js`);
const { insertChunks, hybridRecall, deleteChunksByKb } = await import(`${dist}/lib/chunkRepo.js`);
const { createKb, deleteKb, getKbsByWorkspace } = await import(`${dist}/lib/kbRepo.js`);
const { getDefaultWorkspace } = await import(`${dist}/lib/workspaceRepo.js`);
const { getUserByClerkId } = await import(`${dist}/lib/userRepo.js`);

const DEV_CLERK_ID = process.env.AUTH_BYPASS_CLERK_ID || "dev-bypass-user";

// =====================================================================
// HELD-OUT CORPUS — 27 chunks across restaurant ops, game design, legal
// (identical to reference scripts/validation-eval.mjs)
// =====================================================================
const CHUNKS = [
  { label: "K1", kb: "kitchen", type: "decision",   content: "Decision: Use AvT (Actual vs. Theoretical) food cost variance under 1.5% as the line cook performance bar." },
  { label: "K2", kb: "kitchen", type: "finding",    content: "Finding: Switching the demi-glace base from veal to a 50/50 chicken-veal blend dropped cost per portion from $4.20 to $2.85 with no measurable guest pushback over 200 covers." },
  { label: "K3", kb: "kitchen", type: "convention", content: "Convention: All allergen flags must be documented on the spec sheet using ABCDEF (peanut, treenut, dairy, egg, soy, gluten); shellfish and fish stay separate." },
  { label: "K4", kb: "kitchen", type: "state",      content: "State: Q3 food cost running at 31.4% of revenue; target is 28%. Kitchen equipment depreciation drove half the gap." },
  { label: "K5", kb: "kitchen", type: "question",   content: "Question: Should we switch the bread program to par-baked from our current scratch-bake given the 22-minute ramp-up time?" },
  { label: "K6", kb: "kitchen", type: "reference",  content: "Reference: Sysco price sheet rev 47 — bone-in ribeye CAB locked at $14.80/lb through Sep 30." },
  { label: "K7", kb: "kitchen", type: "decision",   content: "Decision: 86 the truffle pasta from menu v12; replace with mushroom risotto using housemade dashi." },
  { label: "K8", kb: "kitchen", type: "finding",    content: "Finding: Tickets over 22 minutes correlate with 4-star reviews dropping 18%; 18-minute ticket time is the new SLA." },
  { label: "K9", kb: "kitchen", type: "convention", content: "Convention: BOH never accepts modifications past the 9pm rush except for documented medical allergens." },

  { label: "G1", kb: "game", type: "decision",   content: "Decision: Cap RTP (return to player) at 92% across all loot pools; gem boxes were running 96% which broke our F2P economy." },
  { label: "G2", kb: "game", type: "finding",    content: "Finding: Players who hit DAU streak 7+ have 3.4x ARPDAU than first-week players. Streak rewards drive retention better than push notifications." },
  { label: "G3", kb: "game", type: "convention", content: "Convention: All ability cooldowns scale linearly with level; multiplicative scaling caused the Ranger meta in season 4." },
  { label: "G4", kb: "game", type: "state",      content: "State: Boss Aldric's tuning pass lands in v2.7.1; target win rate moves from 18% to 28% after community feedback." },
  { label: "G5", kb: "game", type: "question",   content: "Question: Should the new Ironclad subclass share the ult cooldown with parent Knight, or get its own pool?" },
  { label: "G6", kb: "game", type: "reference",  content: "Reference: Internal balance doc 'Combat Pacing v3' covers the 4-second engagement window for melee." },
  { label: "G7", kb: "game", type: "decision",   content: "Decision: Crafting refunds at 80% of materials, not 100%, to prevent infinite re-roll loops on legendaries." },
  { label: "G8", kb: "game", type: "finding",    content: "Finding: Servers in eu-west run 40% higher peak load than na-east on weekends; need region-specific autoscaling." },
  { label: "G9", kb: "game", type: "convention", content: "Convention: All new content must pass the 'one new mechanic, two reuse' rule per patch." },

  { label: "L1", kb: "legal", type: "decision",   content: "Decision: 30-day cure period in MSA template, not 15. Mid-market enterprise will not sign anything tighter without escalation." },
  { label: "L2", kb: "legal", type: "finding",    content: "Finding: Mutual NDA with two-year term and unlimited carveouts for residuals knowledge has been clean across last 14 deals." },
  { label: "L3", kb: "legal", type: "convention", content: "Convention: Limitation of liability cap is 12 months of fees, never lower; uncapped breach categories are confidentiality, IP indemnity, and gross negligence." },
  { label: "L4", kb: "legal", type: "state",      content: "State: Pending review on 3 redlines from Acme; waiting on their data residency rider before counter-signing." },
  { label: "L5", kb: "legal", type: "question",   content: "Question: Will GDPR Article 28 sub-processor flow-down language need updating after the EDPB May guidance?" },
  { label: "L6", kb: "legal", type: "reference",  content: "Reference: Master service template v4.2 — see clause 11.7 for force majeure exclusions including pandemic-era language." },
  { label: "L7", kb: "legal", type: "decision",   content: "Decision: Reject all most-favored-nation pricing clauses by default; only finance approval can authorize." },
  { label: "L8", kb: "legal", type: "finding",    content: "Finding: Insurance certificate coverage requirements above $5M trigger our broker review; added 14-day notice in template." },
  { label: "L9", kb: "legal", type: "convention", content: "Convention: Counsel sign-off required for any deviation from approved fallback positions in the playbook." },
];

// =====================================================================
// HELD-OUT QUERIES — 35 hand-labeled, organized by edge-case category
// =====================================================================
const QUERIES = [
  { cat: "paraphrase", q: "what's our food cost target",                  expected: ["K4"] },
  { cat: "paraphrase", q: "what's our liability cap",                     expected: ["L3"] },
  { cat: "paraphrase", q: "how long is the cure period in our msa",      expected: ["L1"] },
  { cat: "paraphrase", q: "what's our ticket time service level",         expected: ["K8"] },

  { cat: "acronym",    q: "what's the new max return to player",          expected: ["G1"] },
  { cat: "acronym",    q: "what RTP cap did we set",                       expected: ["G1"] },
  { cat: "acronym",    q: "what does ABCDEF mean in the kitchen",         expected: ["K3"] },
  { cat: "acronym",    q: "explain our actual vs theoretical target",     expected: ["K1"] },

  { cat: "synonym",    q: "what compensation do players get on failed crafts", expected: ["G7"] },
  { cat: "synonym",    q: "what's our food allergy labeling system",      expected: ["K3"] },
  { cat: "synonym",    q: "how do we keep new players coming back",        expected: ["G2"] },
  { cat: "synonym",    q: "what nondisclosure setup do we use",            expected: ["L2"] },

  { cat: "negation",   q: "what pricing clauses do we never accept",      expected: ["L7"] },
  { cat: "negation",   q: "what kitchen mods are off-limits",             expected: ["K9"] },
  { cat: "negation",   q: "what liability is uncapped in our contracts",  expected: ["L3"] },

  { cat: "numeric",    q: "what's running at 92 percent",                 expected: ["G1"] },
  { cat: "numeric",    q: "what costs 14 dollars 80 cents per pound",      expected: ["K6"] },
  { cat: "numeric",    q: "what triggers above 5 million",                 expected: ["L8"] },

  { cat: "polysemy",   q: "what's the boss tuning in 2.7.1",              expected: ["G4"] },
  { cat: "polysemy",   q: "what's the deal with our policy on mods",      expected: ["K9"] },

  { cat: "type-meta",  q: "what conventions do we follow",                expected: ["K3", "K9", "G3", "G9", "L3", "L9"] },
  { cat: "type-meta",  q: "what decisions have we made",                  expected: ["K1", "K7", "G1", "G7", "L1", "L7"] },
  { cat: "type-meta",  q: "list our findings",                            expected: ["K2", "K8", "G2", "G8", "L2", "L8"] },
  { cat: "type-meta",  q: "what state updates do we have",                expected: ["K4", "G4", "L4"] },
  { cat: "type-meta",  q: "what open questions do we have",                expected: ["K5", "G5", "L5"] },
  { cat: "type-meta",  q: "list all references",                          expected: ["K6", "G6", "L6"] },

  { cat: "abstract",   q: "monetization rules in the game",                expected: ["G1", "G7"] },
  { cat: "abstract",   q: "what's in our contract playbook",               expected: ["L1", "L3", "L7", "L9"] },
  { cat: "abstract",   q: "kitchen cost performance",                       expected: ["K1", "K2", "K4"] },

  { cat: "typos",      q: "boss alrdic tuning",                           expected: ["G4"] },
  { cat: "typos",      q: "ticket tim sla",                                expected: ["K8"] },

  { cat: "hard-neg",   q: "what's our diversity hiring policy",            expected: [] },
  { cat: "hard-neg",   q: "blockchain integration roadmap",               expected: [] },
  { cat: "hard-neg",   q: "kitchen automation strategy",                   expected: [] },
  { cat: "hard-neg",   q: "what's our AI go-to-market plan",              expected: [] },
];

// Type intent detection — identical to the reference (and recallService).
const TYPE_INTENT = {
  decision: "decision", decisions: "decision",
  finding: "finding", findings: "finding",
  convention: "convention", conventions: "convention",
  state: "state", states: "state", status: "state",
  question: "question", questions: "question",
  reference: "reference", references: "reference",
};
function detectIntent(q) {
  const ql = q.toLowerCase();
  const words = ql.split(/\W+/).filter(Boolean);
  if (!/^(what|list|show|give\s+me|tell\s+me)\b/.test(ql) || words.length > 8) return null;
  for (const w of words) if (TYPE_INTENT[w]) return TYPE_INTENT[w];
  return null;
}

async function main() {
  console.log("\n=== ContextMaster — VALIDATION eval (held-out data, Redis) ===\n");
  console.log(`Domains: restaurant ops, game design, legal contracts`);
  console.log(`Corpus: ${CHUNKS.length} chunks   Queries: ${QUERIES.length}\n`);

  const redis = getRedis();
  await connectRedis();

  const user = await getUserByClerkId(redis, DEV_CLERK_ID);
  if (!user) throw new Error(`Dev user (${DEV_CLERK_ID}) not found — boot the API once with AUTH_BYPASS=true.`);
  const ws = await getDefaultWorkspace(redis, user.id);
  if (!ws) throw new Error("Default workspace not found for dev user.");

  // Clean prior validation KBs (name prefixed _val_).
  const existing = await getKbsByWorkspace(redis, ws.id);
  const priorVal = existing.filter((k) => k.name.startsWith("_val_"));
  if (priorVal.length) {
    process.stdout.write(`Cleaning ${priorVal.length} prior validation KB(s)... `);
    for (const k of priorVal) {
      await deleteChunksByKb(redis, k.id);
      await deleteKb(redis, k.id, ws.id);
    }
    console.log("done");
  }

  process.stdout.write("Creating validation KBs... ");
  const kbIdsByName = {};
  for (const name of ["kitchen", "game", "legal"]) {
    const kb = await createKb(redis, {
      workspace_id: ws.id,
      name: `_val_${name}`,
      kb_type: "general",
      description: `Validation corpus: ${name}`,
    });
    kbIdsByName[name] = kb.id;
  }
  console.log("done");

  process.stdout.write("Embedding chunks... ");
  const chunkEmbeds = await generateEmbeddings(CHUNKS.map((c) => c.content));
  console.log("done");

  process.stdout.write("Inserting chunks... ");
  const nowIso = new Date().toISOString();
  const idByLabel = {};
  // insertChunks preserves input order in its returned ids, so we can map back.
  const byKb = {};
  CHUNKS.forEach((c, i) => {
    (byKb[c.kb] ??= []).push({
      label: c.label,
      item: {
        row: {
          knowledge_base_id: kbIdsByName[c.kb],
          content: c.content,
          chunk_type: c.type,
          topic_tags: [],
          related_chunk_ids: [],
          source_type: "validation",
          status: "active",
          created_by: user.id,
          session_id: null,
          topic_key: null,
          valid_from: nowIso,
        },
        embedding: chunkEmbeds[i],
      },
    });
  });
  for (const kb of Object.keys(byKb)) {
    const entries = byKb[kb];
    const inserted = await insertChunks(redis, entries.map((e) => e.item));
    inserted.forEach((ins, i) => { idByLabel[entries[i].label] = ins.id; });
  }
  console.log("done");

  process.stdout.write("Embedding queries... ");
  const queryEmbeds = await generateEmbeddings(QUERIES.map((q) => q.q));
  console.log("done\n");

  const allKbIds = Object.values(kbIdsByName);

  // Production config: hybrid + intent, K=8, 0.20 vector floor.
  const perQuery = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    const intent = detectIntent(q.q);
    const hits = await hybridRecall(redis, {
      kbIds: allKbIds,
      queryText: q.q,
      queryEmbedding: queryEmbeds[qi],
      chunkTypes: intent ? [intent] : null,
      matchCount: 8,
      minVectorSimilarity: 0.20,
    });
    const expected = new Set(q.expected.map((l) => idByLabel[l]));
    const retrieved = hits.map((h) => h.id);
    const ret = new Set(retrieved);
    const tp = [...ret].filter((id) => expected.has(id)).length;
    const fp = [...ret].filter((id) => !expected.has(id)).length;
    const fn = [...expected].filter((id) => !ret.has(id)).length;
    perQuery.push({ ...q, intent, retrieved: retrieved.length, tp, fp, fn,
                    queryRecall: expected.size > 0 ? tp / expected.size : null });
  }

  const total = perQuery.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn, ret: a.ret + r.retrieved }),
                                { tp: 0, fp: 0, fn: 0, ret: 0 });
  const precision = (total.tp + total.fp) > 0 ? total.tp / (total.tp + total.fp) : 1;
  const recall = (total.tp + total.fn) > 0 ? total.tp / (total.tp + total.fn) : 1;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log("Overall metrics (production config: hybrid+intent @ K=8)");
  console.log("--------------------------------------------------------");
  console.log(`  Precision:        ${precision.toFixed(3)}`);
  console.log(`  Recall:           ${recall.toFixed(3)}`);
  console.log(`  F1:               ${f1.toFixed(3)}`);
  console.log(`  Avg hits/query:   ${(total.ret / QUERIES.length).toFixed(1)}`);
  console.log(`  TP / FP / FN:     ${total.tp} / ${total.fp} / ${total.fn}\n`);
  console.log("Reference baseline (Supabase, same corpus):");
  console.log("  Tuning:     Precision 0.308   Recall 1.000   F1 0.471\n");

  const cats = [...new Set(QUERIES.map((q) => q.cat))];
  console.log("By edge-case category");
  console.log("---------------------");
  console.log("Category      | Queries | Recall  | Avg hits | Notes");
  console.log("--------------|---------|---------|----------|------");
  for (const cat of cats) {
    const rows = perQuery.filter((r) => r.cat === cat);
    const realRows = rows.filter((r) => r.queryRecall !== null);
    const avgRecall = realRows.length > 0
      ? realRows.reduce((a, r) => a + r.queryRecall, 0) / realRows.length
      : null;
    const avgHits = rows.reduce((a, r) => a + r.retrieved, 0) / rows.length;
    const recallStr = avgRecall === null ? "  N/A  " : avgRecall.toFixed(3);
    const fpsForHardNeg = cat === "hard-neg" ? `(${rows.reduce((a, r) => a + r.fp, 0)} FPs)` : "";
    console.log(`${cat.padEnd(13)} |   ${String(rows.length).padStart(3)}   |  ${recallStr}  |   ${avgHits.toFixed(1).padStart(4)}   | ${fpsForHardNeg}`);
  }

  const misses = perQuery.filter((r) => r.fn > 0);
  if (misses.length > 0) {
    console.log("\n=== Queries with missed expected chunks ===\n");
    for (const m of misses) {
      console.log(`  [${m.cat}] "${m.q}"`);
      console.log(`     expected ${m.expected.length}, retrieved ${m.retrieved}, missed ${m.fn}` + (m.intent ? ` [intent=${m.intent}]` : ""));
    }
  } else {
    console.log("\n*** No misses — every expected chunk was retrieved on every query. ***\n");
  }

  console.log("\n=== Per-query detail ===");
  console.log("category   | tp/expected | retrieved | query");
  console.log("-----------|-------------|-----------|------");
  for (const r of perQuery) {
    const exp = r.expected.length;
    const rec = exp === 0 ? `(${r.fp} FPs)` : `${r.tp}/${exp}`;
    const tag = exp === 0 ? " " : (r.tp === exp ? "★" : (r.tp > 0 ? "·" : "✗"));
    console.log(`${tag} ${r.cat.padEnd(9)} | ${rec.padStart(11)} |    ${String(r.retrieved).padStart(2)}     | ${r.q}${r.intent ? ` [${r.intent}]` : ""}`);
  }

  // Cleanup — keep the dev workspace tidy and the eval repeatable.
  process.stdout.write("\nCleaning up validation KBs... ");
  for (const id of allKbIds) {
    await deleteChunksByKb(redis, id);
    await deleteKb(redis, id, ws.id);
  }
  console.log("done");

  await redis.quit();
}

main().catch((err) => {
  console.error("Validation failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
