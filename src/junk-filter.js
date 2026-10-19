// High-precision patterns for feed junk the LLM keeps letting through
// (hiring ads, award posts, engagement bait, course promos). Matching one
// short-circuits to "hide" with no inference at all.
//
// The safety property that matters: these must never fire on content the
// reader actually wants. src/checks.js asserts that against the eval corpus —
// add a rule only with a corpus case backing it, and add an adversarial case
// for anything the rule could plausibly over-claim.
//
// `window` limits a rule to the first N characters. Job ads lead with the
// pitch; a technical post that ends "by the way, we're hiring" is not an ad.
const RULES = [
  {
    name: "hiring",
    re: /\b(we(?:'re| are|’re)? hiring|now hiring|job opening|we are looking for talented)\b/i,
    window: 200,
  },
  { name: "hiring-tag", re: /#(hiring|jobs|opentowork|jobopportunity)\b/i },
  {
    name: "apply-cta",
    re: /\b(apply (?:now|here|through the link)|send me your (?:cv|resume)|dm me (?:your|to apply))\b/i,
  },
  {
    name: "engagement-bait",
    re: /(♻️|\brepost to (?:inspire|share|help)\b|\btag someone who\b|\bdrop it in the comments\b)/i,
  },
  // Narrow: "thrilled to announce" on its own is how people announce genuine
  // work too (open-sourcing a project, shipping a feature). Require actual
  // award or recognition vocabulary alongside it.
  {
    name: "award-post",
    re: /\bnamed (?:a |an )?top (?:employer|workplace|company|place to work)\b|\b(?:won|winner of|recipient of)\b[^.]{0,60}\baward\b/i,
  },
  {
    name: "award-announcement",
    re: /\b(thrilled|humbled|honou?red|proud|delighted) to (?:share|announce)\b[\s\S]{0,160}?\b(award|awards|recognition|recognised|recognized|certified|great place to work|top employer|anniversary)\b/i,
  },
  {
    name: "course-promo",
    re: /\b(limited seats|enroll now|click here to learn more|link in (?:the )?(?:bio|comments) to (?:join|enroll))\b/i,
  },
];

// Returns the name of the first rule that matches, or null.
export function matchJunkRule(text) {
  for (const rule of RULES) {
    const haystack = rule.window ? text.slice(0, rule.window) : text;
    if (rule.re.test(haystack)) return rule.name;
  }
  return null;
}

export const JUNK_RULE_NAMES = RULES.map((r) => r.name);
