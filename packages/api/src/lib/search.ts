// RediSearch query helpers shared by every recall/dedup/routing path.

// Characters RediSearch treats as special inside a query. TAG values (UUIDs,
// kebab-case topic_keys, etc.) contain hyphens and must be escaped, or the
// parser throws "Syntax error". We escape every non-alphanumeric/underscore
// char with a backslash — safe and exhaustive.
const TAG_SPECIAL = /[^a-zA-Z0-9_]/g;

export function escapeTag(value: string): string {
  return value.replace(TAG_SPECIAL, "\\$&");
}

// A TAG ... IN (a|b|c) filter: @field:{a|b|c} with each value escaped.
export function tagIn(field: string, values: string[]): string {
  if (values.length === 0) return "";
  return `@${field}:{${values.map(escapeTag).join("|")}}`;
}

// Pack an embedding vector into the little-endian FLOAT32 blob RediSearch
// expects for KNN ($BLOB params) and for HSET of the `embedding`/
// `description_embedding` fields.
export function floatBuf(vec: number[] | Float32Array): Buffer {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}
