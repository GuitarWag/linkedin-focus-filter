// Scores the non-model baselines against the corpus. No model, no GPU, no
// browser — runs in node so "is the model worth it?" can be re-checked cheaply
// whenever the corpus grows.
//
//   npm run bench:baselines
import { POSTS, INTERESTS } from "./bench-corpus.js";
import { expandedKeywordMatch, keywordMatch } from "./baselines.js";
import { matchJunkRule } from "./junk-filter.js";
import { emptyScore, penalty, recordOutcome, summarise } from "./eval-harness.js";

const STRATEGIES = [
  {
    name: "always hide",
    decide: () => "NO",
  },
  {
    name: "always show",
    decide: () => "YES",
  },
  {
    name: "junk rules only",
    decide: (text) => (matchJunkRule(text) ? "NO" : "YES"),
  },
  {
    name: "junk rules + literal interest words",
    decide: (text, interests) =>
      matchJunkRule(text) ? "NO" : keywordMatch(text, interests) ? "YES" : "NO",
  },
  {
    name: "junk rules + hand-expanded vocabulary",
    decide: (text, interests) =>
      matchJunkRule(text) ? "NO" : expandedKeywordMatch(text, interests) ? "YES" : "NO",
  },
];

const rows = [];
for (const strategy of STRATEGIES) {
  const score = emptyScore();
  for (const kase of POSTS) {
    const rule = matchJunkRule(kase.text);
    const got = strategy.decide(kase.text, kase.interests || INTERESTS);
    recordOutcome(score, kase, got, { viaRule: rule && got === "NO" ? rule : null });
  }
  rows.push({ name: strategy.name, score: summarise(score) });
}

console.log(`corpus: ${POSTS.length} cases · interests: ${INTERESTS}\n`);
for (const { name, score } of rows) {
  console.log(
    `${String(score.correct).padStart(2)}/${score.n} correct  ` +
      `false-hide=${score.falseHide}  false-pass=${score.falsePass}  ` +
      `penalty=${String(score.penalty).padStart(2)}  ${name}`
  );
  for (const m of score.misses) {
    console.log(`      MISS ${m.label.padEnd(24)} want ${m.want} got ${m.got}`);
  }
}

const best = rows.slice().sort((a, b) => penalty(a.score) - penalty(b.score))[0];
console.log(`\nbest non-model baseline: ${best.name} (penalty ${best.score.penalty})`);
