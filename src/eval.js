// Backend comparison over the eval corpus: the shipped generative model
// against decision models, all through the same harness (junk rules first,
// then the backend). Run headless with `npm run eval`, or open test/eval.html.
// ?backends=llama,kev picks which ones run.
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { OpenJev } from "open-jev";
import { loadLaya } from "./laya.js";
import { MODEL_ID } from "./bench-corpus.js";
import { DEFAULT_OPTIONS, MODEL_REPO, buildQuestions, judge } from "./decision.js";
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
const DECOYS = ["general news or opinion", "personal story or career", "advertising or promotion"];
const TECHNICAL = "Which of these does this post discuss in technical depth?";

// The same intent as "ai engineer, software engineer, SDLC", written as
// described topics. Tests whether rephrasing interests (a popup hint) helps.
const DESCRIBED_INTERESTS = [
  "AI engineering: building with LLMs and agents, model releases, benchmarks, evals, AI tooling",
  "Software engineering: code, architecture, design principles, testing, code review, engineering practice",
  "Infrastructure and DevOps: cloud, Kubernetes, CI/CD, GPUs, deployment, reliability",
  "Developer tools: coding agents, IDEs, frameworks, open-source tools, side projects",
].join("\n");

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
      const answers = await decide(text, buildQuestions(interests, kase.avoid ?? "", o));
      const v = judge(interests, answers, o);
      return `${v.answer} ${v.raw}`;
    },
  });
  return [
    variant("shipped (decision.js defaults)", {}),
    variant("technical-depth + decoys", { instructions: TECHNICAL, decoys: DECOYS }),
    variant("no other description", { otherDescription: "" }),
    variant("technical-depth wording", { instructions: TECHNICAL }),
    variant("described interests", { interests: DESCRIBED_INTERESTS }),
    variant("described interests, no other description", { interests: DESCRIBED_INTERESTS, otherDescription: "" }),
    variant("described interests + technical", { interests: DESCRIBED_INTERESTS, instructions: TECHNICAL }),
    variant("described interests, yes >= 0.5", { interests: DESCRIBED_INTERESTS, minConfidence: 0.5 }),
  ];
}

// Each backend loads once and returns the strategies it contributes.
const BACKENDS = {
  async llama() {
    const base = new URL(`models/${MODEL_ID}/`, location.href).href;
    const engine = await CreateMLCEngine(MODEL_ID, {
      appConfig: {
        cacheBackend: "indexeddb",
        model_list: [
          {
            model: base,
            model_id: MODEL_ID,
            model_lib: base + "model.wasm",
            vram_required_MB: 879.04,
            low_resource_required: true,
            overrides: { context_window_size: 4096 },
          },
        ],
      },
      initProgressCallback: (p) => progress(p.text),
    });
    const callModel = async (messages, maxTokens) => {
      const r = await engine.chat.completions.create({ messages, max_tokens: maxTokens, temperature: 0 });
      return r.choices[0]?.message?.content?.trim() ?? "";
    };
    return {
      callModel,
      strategies: [
        {
          name: "llama-1b: shipped prompt",
          maxTokens: 8,
          chars: 800,
          system: (i) =>
            `Topics: ${i}. Is this post mainly about one of those topics? Answer in English, YES or NO.`,
        },
      ],
    };
  },

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
  const wanted = (new URLSearchParams(location.search).get("backends") || "llama,kev,laya").split(",");
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
          const score = await evaluate({ cases, strategy, interests, callModel: backend.callModel });
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
