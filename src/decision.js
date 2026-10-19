// The questions the decision model answers for each post, and how its answers
// become a verdict. Shared by the extension and the eval, so the eval measures
// exactly what ships.
//
// Question 1 is a choice over the reader's own topics plus escape options;
// naming each topic as its own option gives the model something concrete to
// match. Question 2, when the reader lists topics to avoid, is a choice over
// those plus "none of these". Question 3 asks what kind of post it is, and a
// topic match only counts for an explanation or a release: a holiday story
// that name-drops a tool matches the topic, and this is what catches it. Kev
// answers all of them in one forward pass.
//
// Interests may be written one per line as "topic: what it covers". Bare role
// words ("software engineer") made the model file Kubernetes and benchmark
// posts under "something else"; a description names what belongs there.
export const OTHER = "something else";
export const NONE = "none of these";
export const MODEL_REPO = "onnx-community/kev-0.6b-ONNX";

// What kind of post it is. Only `keep` passes. Describing each option moved
// two more fluff posts out of "technical explanation" on the real-post set.
export const KIND_GATE = {
  type: "choice",
  instructions: "What kind of post is this?",
  options: [
    "technical explanation or analysis",
    "product, model or research release",
    "personal story or career update",
    "opinion or hot take",
    "joke or meme",
    "ad, promotion or hiring",
    "people or profile recommendation",
  ],
  descriptions: {
    "technical explanation or analysis":
      "teaches, compares, or analyses how something works, with concrete technical detail in the body",
    "product, model or research release": "announces a model, tool, benchmark, platform, or paper",
    "personal story or career update":
      "an anecdote about a person, a job, a hobby project, or a life event, even when it mentions tools",
    "opinion or hot take": "a general take or life lesson with no technical detail",
    "joke or meme": "humour, a meme, or a one-liner",
    "ad, promotion or hiring": "sells a product, a course, or a service, or recruits",
    "people or profile recommendation": "introduces a person or a team",
  },
  keep: ["technical explanation or analysis", "product, model or research release"],
};

// The shipped settings. src/eval.js compares variants of these. On 50 real
// feed posts with described interests: topic question alone hid 1 wanted post
// and passed 12 fluff posts; the prefix and the kind gate bring that to 1 and 6.
export const DEFAULT_OPTIONS = {
  instructions: "What is this post mainly about?",
  decoys: [],
  // Tells the model what should fall through to OTHER.
  otherDescription:
    "news, business, markets, personal stories, jokes, ads, hype, or anything without technical substance",
  minConfidence: 0,
  avoidMinConfidence: 0,
  // Put in front of the post in the state. Telling the model what the text
  // is cost nothing and fixed one false-pass.
  statePrefix: "LinkedIn feed post:\n",
  // Optional last question that must pass for a YES. A noul statement
  // ({ type: "noul", instructions, min?, max? }) passes when p(yes) is within
  // [min, max]; a score ({ type: "score", instructions, options, min?, max? })
  // likewise on its normalized value; a choice ({ type: "choice",
  // instructions, options, keep }) when the pick is in `keep`.
  gate: KIND_GATE,
};

// Posts styled with Unicode "mathematical bold" letters (𝗦𝗼𝗻𝗻𝗲𝘁) tokenize as
// garbage; NFKC folds them back to plain letters. Also collapses whitespace.
export function cleanText(text) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export const buildState = (text, opts = DEFAULT_OPTIONS) => (opts.statePrefix || "") + text;

// "a, b, c" or one per line; each item may be "label: description".
export function parseTopics(text = "") {
  const items = text.includes("\n") ? text.split("\n") : text.split(/[,;]/);
  const seen = new Map();
  for (const item of items) {
    const i = item.indexOf(":");
    const label = (i < 0 ? item : item.slice(0, i)).trim().replace(/\.$/, "");
    const description = i < 0 ? "" : item.slice(i + 1).trim();
    if (label && !seen.has(label)) seen.set(label, description);
  }
  return seen; // label -> description ("" when none)
}

export const topics = (text) => [...parseTopics(text).keys()];

function choiceQuestion(instructions, entries) {
  const descriptions = {};
  for (const [label, d] of entries) if (d) descriptions[label] = d;
  const q = { type: "choice", instructions, options: entries.map(([label]) => label) };
  if (Object.keys(descriptions).length) q.descriptions = descriptions;
  return q;
}

// Plain objects rather than open-jev's builders so the content script can
// import this without bundling the model runtime.
export function buildQuestions(interests, avoid = "", opts = DEFAULT_OPTIONS) {
  const wanted = parseTopics(interests);
  const entries = [...wanted];
  for (const d of opts.decoys) if (!wanted.has(d)) entries.push([d, ""]);
  entries.push([OTHER, opts.otherDescription]);
  const questions = [choiceQuestion(opts.instructions, entries)];

  const unwanted = parseTopics(avoid);
  if (unwanted.size) {
    questions.push(choiceQuestion("Is this post mainly about one of these?", [...unwanted, [NONE, ""]]));
  }
  if (opts.gate) {
    const { min, max, keep, ...q } = opts.gate;
    questions.push(q);
  }
  return questions;
}

function describe(a) {
  if (a.type === "noul") return `yes=${a.probability.toFixed(2)}`;
  if (a.type === "score") return `${a.level} (${a.normalized.toFixed(2)})`;
  return `${a.choice} (${a.confidence.toFixed(2)})`;
}

function gatePasses(gate, a) {
  if (gate.type === "choice") return gate.keep.includes(a.choice);
  const v = gate.type === "noul" ? a.probability : a.normalized;
  return v >= (gate.min ?? 0) && v <= (gate.max ?? 1);
}

// answers[i] is open-jev's answer for questions[i], in the order
// buildQuestions made them: topic, then avoid (when given), then gate (when set).
export function judge(interests, answers, opts = DEFAULT_OPTIONS) {
  const main = answers[0];
  const gate = opts.gate ? answers[answers.length - 1] : null;
  const avoid = answers.length > (gate ? 2 : 1) ? answers[1] : null;
  const raw = answers.map(describe).join(" / ");
  if (avoid && avoid.choice !== NONE && avoid.confidence >= opts.avoidMinConfidence) {
    return { answer: "NO", reason: `avoid: ${avoid.choice}`, raw };
  }
  const matched = parseTopics(interests).has(main.choice) && main.confidence >= opts.minConfidence;
  if (matched && gate && !gatePasses(opts.gate, gate)) {
    return { answer: "NO", reason: `gate: ${describe(gate)}`, raw };
  }
  return { answer: matched ? "YES" : "NO", reason: main.choice, raw };
}
