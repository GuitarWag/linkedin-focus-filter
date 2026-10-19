import { POSTS, INTERESTS } from "./bench-corpus.js";
import { expandedKeywordMatch } from "./baselines.js";
import { matchJunkRule } from "./junk-filter.js";
for (const p of POSTS) {
  if (matchJunkRule(p.text)) continue;
  const hit = expandedKeywordMatch(p.text, p.interests || INTERESTS);
  console.log(`want ${p.want}  matched-on: ${(hit || "(nothing)").padEnd(12)} ${p.label}`);
}
