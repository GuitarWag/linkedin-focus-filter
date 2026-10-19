// Non-LLM baselines, so "does the model earn its keep?" is a measured
// question rather than an assumption. Whole-word matching only: substring
// matching on an interest like "ai" fires on said/email/detail/available.
function termsFrom(interests) {
  return interests
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Does the text contain any interest term as a whole word / phrase?
export function keywordMatch(text, interests) {
  const lower = text.toLowerCase();
  for (const term of termsFrom(interests)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(lower)) return term;
  }
  return null;
}

// A hand-written expansion, i.e. the best a keyword approach can realistically
// do without an LLM: someone has to enumerate the vocabulary in advance.
const EXPANSIONS = {
  "software engineer": [
    "software", "developer", "programming", "code", "codebase", "refactor",
    "algorithm", "algorithms", "big-o", "complexity", "data structures", "api",
  ],
  ai: ["ai", "llm", "llms", "machine learning", "ml", "rag", "model", "agents", "gpt", "neural"],
  sql: ["sql", "postgres", "postgresql", "mysql", "query", "database", "index", "join", "explain analyze"],
  cloud: ["cloud", "aws", "gcp", "azure", "kubernetes", "k8s", "eks", "ecs", "serverless", "docker", "terraform"],
};

export function expandedKeywordMatch(text, interests) {
  const lower = text.toLowerCase();
  for (const term of termsFrom(interests)) {
    const vocab = EXPANSIONS[term] ?? [term];
    for (const word of vocab) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "u");
      if (re.test(lower)) return word;
    }
  }
  return null;
}
