import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Defaults match the reference (text-embedding-3-small @ 1536 dims). Overridable
// via env so the embedding model and the RediSearch vector DIM stay in lockstep.
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);

// Generate an embedding vector for a single text string.
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

// Generate embeddings for multiple texts in a single batch call.
// Returns embeddings in the same order as inputs.
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // OpenAI supports batching up to 2048 inputs.
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  // Sort by index to maintain input order.
  return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
