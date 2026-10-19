// Shared evaluation machinery for the benchmarks.
//
// Corpus = the built-in cases plus anything exported from the live activity
// log (test/corpus-extra.json). Scoring separates the two error directions
// because they are not equally bad: hiding something wanted is worse than
// letting junk through, so the headline score weights it double.
import { POSTS as BUILTIN, INTERESTS as DEFAULT_INTERESTS } from "./bench-corpus.js";
import { matchJunkRule } from "./junk-filter.js";
import { parseVerdict } from "./verdict.js";

export const FALSE_HIDE_WEIGHT = 2;

export async function loadCorpus({ extraUrl = "./corpus-extra.json" } = {}) {
  const builtin = BUILTIN.map((p) => ({ ...p, source: "builtin" }));
  let extra = [];
  try {
    const res = await fetch(extraUrl, { cache: "no-store" });
    if (res.ok) {
      const raw = await res.json();
      extra = raw
        .filter((c) => c && c.text && (c.want === "YES" || c.want === "NO"))
        .map((c, i) => ({
          label: c.label || `extra-${i}`,
          want: c.want,
          text: c.text,
          interests: c.interests,
          avoid: c.avoid,
          source: "log",
        }));
    }
  } catch {
    // no exported corpus yet; built-ins are enough to run
  }
  return [...builtin, ...extra];
}

// Group cases by the interests they were judged against — a case labelled
// under different interests isn't comparable to one labelled under yours.
export function groupByInterests(cases, fallback = DEFAULT_INTERESTS) {
  const groups = new Map();
  for (const c of cases) {
    const key = (c.interests || fallback).trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return groups;
}

export function emptyScore() {
  return {
    n: 0,
    correct: 0,
    falseHide: 0, // wanted YES, we said NO — the expensive mistake
    falsePass: 0, // wanted NO, we said YES
    ruleHits: 0,
    modelCalls: 0,
    latencyTotal: 0,
    misses: [],
  };
}

export function recordOutcome(score, kase, got, { latencyMs = 0, viaRule = null, raw = "" } = {}) {
  score.n++;
  score.latencyTotal += latencyMs;
  if (viaRule) score.ruleHits++;
  else score.modelCalls++;

  if (got === kase.want) {
    score.correct++;
    return;
  }
  if (kase.want === "YES") score.falseHide++;
  else score.falsePass++;
  score.misses.push({ label: kase.label, want: kase.want, got, viaRule, raw });
}

// Lower is better. Only used to rank strategies against each other.
export function penalty(score) {
  return score.falseHide * FALSE_HIDE_WEIGHT + score.falsePass;
}

export function summarise(score) {
  const accuracy = score.n ? score.correct / score.n : 0;
  const wantedYes = score.n - (score.correct + score.falsePass - score.falseHide) || 0;
  return {
    ...score,
    accuracy,
    penalty: penalty(score),
    meanLatency: score.modelCalls ? Math.round(score.latencyTotal / score.modelCalls) : 0,
    wantedYes,
  };
}

// Run one strategy over one interest group. `callModel` does the inference so
// this module stays free of engine concerns.
export async function evaluate({ cases, strategy, interests, callModel, useJunkRules = true }) {
  const score = emptyScore();

  for (const kase of cases) {
    // Mirror the shipped order: cheap deterministic rules first, model second.
    const rule = useJunkRules ? matchJunkRule(kase.text) : null;
    if (rule) {
      recordOutcome(score, kase, "NO", { viaRule: rule });
      continue;
    }

    const messages = strategy.system ? [{ role: "system", content: strategy.system(interests) }] : [];
    for (const shot of strategy.shots ?? []) {
      messages.push({ role: "user", content: shot.user });
      messages.push({ role: "assistant", content: shot.assistant });
    }
    messages.push({ role: "user", content: kase.text.slice(0, strategy.chars ?? 800) });

    // A decision model answers the question directly instead of generating
    // text, so it takes the post and interests rather than chat messages.
    const started = performance.now();
    const raw = strategy.decide
      ? await strategy.decide(kase.text.slice(0, strategy.chars ?? 800), interests, kase)
      : await callModel(messages, strategy.maxTokens ?? 8);
    const latencyMs = performance.now() - started;
    const got = (strategy.parse ?? parseVerdict)(raw);
    recordOutcome(score, kase, got, { latencyMs, raw });
  }

  return summarise(score);
}

export function formatScore(name, s) {
  return (
    `${String(s.correct)}/${s.n} correct` +
    `  false-hide=${s.falseHide}  false-pass=${s.falsePass}` +
    `  penalty=${s.penalty}` +
    `  ${String(s.meanLatency).padStart(4)}ms/call` +
    `  rules=${s.ruleHits}` +
    `  ${name}`
  );
}
