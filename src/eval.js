// Backend comparison over the eval corpus: the shipped decision model against
// other decision models, all through the same harness (junk rules first, then
// the model). Run headless with `npm run eval`, or open test/eval.html.
// ?backends=kev,laya picks which ones run.
import { OpenJev } from "open-jev";
import { loadLaya } from "./laya.js";
import { DEFAULT_OPTIONS, KIND_GATE, MODEL_REPO, buildQuestions, buildState, judge } from "./decision.js";
import { evaluate, formatScore, groupByInterests, loadCorpus, penalty } from "./eval-harness.js";

function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}
const progress = (text) => (document.getElementById("progress").textContent = text);

// One strategy per decision.js option set, for any decision model with
// decide(text, questions) -> [{choice, confidence}]. A case's own avoid list
// (if any) is used; cases without one test the interest question alone.

// The same intent as "ai engineer, software engineer, SDLC", written as
// described topics. Tests whether rephrasing interests (a popup hint) helps.
const DESCRIBED_INTERESTS = [
  "AI engineering: building with LLMs and agents, model releases, benchmarks, evals, AI tooling",
  "Software engineering: code, architecture, design principles, testing, code review, engineering practice",
  "Infrastructure and DevOps: cloud, Kubernetes, CI/CD, GPUs, deployment, reliability",
  "Developer tools: coding agents, IDEs, frameworks, open-source tools, side projects",
].join("\n");

// Alternatives to the shipped gate and prefix, kept so a change in the corpus
// can re-rank them.
const KIND_SPLIT = {
  ...KIND_GATE,
  options: [
    "technical explanation or analysis",
    "AI model, benchmark or research news",
    "product launch or marketing",
    ...KIND_GATE.options.slice(2),
  ],
  descriptions: {
    ...KIND_GATE.descriptions,
    "AI model, benchmark or research news": "a new model, a benchmark result, a paper, or an engineering platform",
    "product launch or marketing": "pitches a product or an app to potential customers",
  },
  keep: ["technical explanation or analysis", "AI model, benchmark or research news"],
};
const BODY_PREFIX = "LinkedIn feed post. Judge the body of the post, not the tools or job titles it name-drops.\n";

function decisionVariants(model, decide) {
  // Laya picks an avoid topic at low confidence on unrelated posts (0.37-0.43
  // on Kubernetes and vector DB posts), so its variants gate the avoid answer.
  const base = model === "laya" ? { avoidMinConfidence: 0.6 } : {};
  const variant = (name, opts) => ({
    name: `${model}: ${name}`,
    chars: 800,
    decide: async (text, caseInterests, kase) => {
      const o = { ...DEFAULT_OPTIONS, ...base, ...opts };
      const interests = o.interests ?? caseInterests;
      const answers = await decide(buildState(text, o), buildQuestions(interests, kase.avoid ?? "", o));
      return judge(interests, answers, o);
    },
  });
  const D = { interests: DESCRIBED_INTERESTS };
  // Laya's port speaks choice questions only, and its gate answers were never
  // measured; it runs without one.
  if (model === "laya") {
    return [
      variant("role-word interests, no gate", { gate: null }),
      variant("described interests, no gate", { ...D, gate: null }),
    ];
  }
  return [
    variant("shipped (decision.js defaults) with described interests", D),
    variant("shipped with role-word interests", {}),
    variant("described, no gate", { ...D, gate: null }),
    variant("described, no gate, no prefix", { ...D, gate: null, statePrefix: "" }),
    variant("described, plain kind options", { ...D, gate: { ...KIND_GATE, descriptions: undefined } }),
    variant("described, research/marketing split", { ...D, gate: KIND_SPLIT }),
    variant("described, body prefix", { ...D, statePrefix: BODY_PREFIX }),
    variant("described, body prefix + split", { ...D, statePrefix: BODY_PREFIX, gate: KIND_SPLIT }),
    // Measured and dropped: noul "substance"/"fluff" statements (Kev says yes
    // to nearly every post), a 4-level substance score (false-hides), an "is
    // English" noul (no change), keeping "opinion" in the kind gate (no
    // change), a sharper OTHER description (no change). See git history.
  ];
}

// Each backend loads once and returns the strategies it contributes.
const BACKENDS = {
  // Kev-0.6B: a Jev-shaped decision model (Qwen3-0.6B base). One forward
  // pass returns a probability per option; nothing is generated.
  async kev() {
    const jev = await OpenJev.load({
      model: MODEL_REPO,
      onProgress: ({ progress: p }) => progress(`kev-0.6b ${Math.round(p * 100)}%`),
    });
    log(`kev runtime: ${JSON.stringify(jev.runtime)}`);
    return { strategies: decisionVariants("kev", (text, qs) => jev.decide(text, qs)) };
  },

  // Laya-typed-decisions (ModernBERT-large, fp16 ~850 MB, downloaded once).
  async laya() {
    const laya = await loadLaya({ onProgress: (p) => progress(`laya ${Math.round(p * 100)}%`) });
    return { strategies: decisionVariants("laya", laya.decide) };
  },
};

async function run() {
  const wanted = (new URLSearchParams(location.search).get("backends") || "kev,laya").split(",");
  const results = [];
  try {
    const corpus = await loadCorpus();
    const fromLog = corpus.filter((c) => c.source === "log").length;
    log(`corpus: ${corpus.length} cases (${corpus.length - fromLog} built-in, ${fromLog} from the log)`);
    const groups = groupByInterests(corpus);

    for (const name of wanted) {
      log(`\nloading ${name}…`);
      const t0 = performance.now();
      const backend = await BACKENDS[name]();
      log(`${name} ready in ${Math.round(performance.now() - t0)}ms`);
      for (const strategy of backend.strategies) {
        for (const [interests, cases] of groups) {
          const score = await evaluate({ cases, strategy, interests });
          results.push({ interests, name: strategy.name, score });
          log(`\n=== ${strategy.name}  [${interests}]`);
          log(formatScore(strategy.name, score));
          score.misses.forEach((m) =>
            log(`   MISS ${m.label.padEnd(30)} want ${m.want} got ${m.got} ${m.viaRule ? `[rule ${m.viaRule}]` : `| ${m.raw.slice(0, 50)}`}`)
          );
        }
      }
    }

    log("\n===== SUMMARY (lower penalty is better; false-hide counts double) =====");
    results
      .slice()
      .sort((a, b) => penalty(a.score) - penalty(b.score) || a.score.meanLatency - b.score.meanLatency)
      .forEach((r) => log(`${formatScore(r.name, r.score)}  [${r.interests}]`));
  } catch (err) {
    log(`ERROR: ${err.stack || err.message || err}`);
  }
  window.__EVAL__ = results;
  log("\ndone");
}

run();
