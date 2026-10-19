// The questions the decision model answers for each post, and how its answers
// become a verdict. Shared by the extension and the eval, so the eval measures
// exactly what ships.
//
// Question 1 is a choice over the reader's own topics plus escape options;
// naming each topic as its own option gives the model something concrete to
// match. Question 2, when the reader lists topics to avoid, is a choice over
// those plus "none of these". Kev answers both in one forward pass.
//
// Interests may be written one per line as "topic: what it covers". Bare role
// words ("software engineer") made the model file Kubernetes and benchmark
// posts under "something else"; a description names what belongs there.
export const OTHER = "something else";
export const NONE = "none of these";
export const MODEL_REPO = "onnx-community/kev-0.6b-ONNX";

// The shipped settings. src/eval.js compares variants of these. On 50 real
// feed posts, described interests plus this OTHER description hid 1 wanted
// post (vs 7 for bare role words) at the cost of passing more fluff.
export const DEFAULT_OPTIONS = {
  instructions: "What is this post mainly about?",
  decoys: [],
  // Tells the model what should fall through to OTHER.
  otherDescription:
    "news, business, markets, personal stories, jokes, ads, hype, or anything without technical substance",
  minConfidence: 0,
  avoidMinConfidence: 0,
};

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
  return questions;
}

// answers[i] = { choice, confidence } for questions[i]; choice is the label.
export function judge(interests, answers, opts = DEFAULT_OPTIONS) {
  const [main, avoid] = answers;
  const raw = answers.map((a) => `${a.choice} (${a.confidence.toFixed(2)})`).join(" / ");
  if (avoid && avoid.choice !== NONE && avoid.confidence >= opts.avoidMinConfidence) {
    return { answer: "NO", reason: `avoid: ${avoid.choice}`, raw };
  }
  const matched = parseTopics(interests).has(main.choice) && main.confidence >= opts.minConfidence;
  return { answer: matched ? "YES" : "NO", reason: main.choice, raw };
}
