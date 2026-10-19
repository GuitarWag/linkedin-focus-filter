// Prompt-strategy benchmark over the eval corpus (built-in cases plus
// anything exported from the live log). Evaluates the shipped pipeline —
// junk rules first, then the model — so the numbers mean what they say.
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { MODEL_ID } from "./bench-corpus.js";
import {
  evaluate,
  formatScore,
  groupByInterests,
  loadCorpus,
  penalty,
} from "./eval-harness.js";

const STRATEGIES = [
  {
    name: "shipped: plain topical question",
    maxTokens: 8,
    chars: 800,
    system: (interests) =>
      `Topics: ${interests}. Is this post mainly about one of those topics? Answer in English, YES or NO.`,
  },
  {
    name: "plain + mainly-about emphasis",
    maxTokens: 8,
    chars: 800,
    system: (interests) =>
      `Topics: ${interests}. Answer YES only if the post's main subject is one of those topics, ` +
      `not merely mentioned in passing. Answer in English, YES or NO.`,
  },
  {
    name: "plain + substance test",
    maxTokens: 8,
    chars: 800,
    system: (interests) =>
      `Topics: ${interests}. Answer YES if the post teaches, explains or reports something ` +
      `concrete about one of those topics. Answer NO if it is mainly about the author, their ` +
      `company or their career. Answer in English, YES or NO.`,
  },
  {
    name: "reader framing",
    maxTokens: 8,
    chars: 800,
    system: (interests) =>
      `A reader follows these topics: ${interests}. Would this post be worth their time on ` +
      `those topics? Answer in English, YES or NO.`,
  },
  {
    name: "strict policy (superseded)",
    maxTokens: 16,
    chars: 800,
    system: (interests) =>
      `You are a strict content filter for a social feed. The reader's interests are: ${interests}. ` +
      `Default to NO. Only answer YES if the post is substantively and specifically about one of these ` +
      `interests — a passing buzzword, a generic career or motivational post, a job/hiring post, or vague ` +
      `hype does not count as YES. When unsure, answer NO.`,
  },
];

function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

let engine = null;

async function loadEngine() {
  const modelBase = new URL(`models/${MODEL_ID}/`, location.href).href;
  log(`loading ${MODEL_ID}…`);
  engine = await CreateMLCEngine(MODEL_ID, {
    appConfig: {
      cacheBackend: "indexeddb",
      model_list: [
        {
          model: modelBase,
          model_id: MODEL_ID,
          model_lib: new URL(`models/${MODEL_ID}/model.wasm`, location.href).href,
          vram_required_MB: 879.04,
          low_resource_required: true,
          overrides: { context_window_size: 4096 },
        },
      ],
    },
    initProgressCallback: (p) => {
      document.getElementById("progress").textContent = p.text;
    },
  });
  log("engine ready\n");
}

async function callModel(messages, maxTokens) {
  const reply = await engine.chat.completions.create({
    messages,
    max_tokens: maxTokens,
    temperature: 0,
  });
  return reply.choices[0]?.message?.content?.trim() ?? "";
}

async function run() {
  document.getElementById("run").disabled = true;
  try {
    const corpus = await loadCorpus();
    const fromLog = corpus.filter((c) => c.source === "log").length;
    log(`corpus: ${corpus.length} cases (${corpus.length - fromLog} built-in, ${fromLog} from the log)`);

    const groups = groupByInterests(corpus);
    log(`interest groups: ${groups.size}\n`);

    if (!engine) await loadEngine();
    log("warmup…");
    await callModel([{ role: "user", content: "say YES" }], 4);

    const table = [];
    for (const [interests, cases] of groups) {
      log(`\n########## interests: ${interests}  (${cases.length} cases)`);
      for (const strategy of STRATEGIES) {
        const score = await evaluate({
          cases,
          strategy,
          interests,
          callModel,
        });
        table.push({ interests, name: strategy.name, score });
        log(`\n=== ${strategy.name}`);
        log(
          `${score.correct}/${score.n} correct · false-hide ${score.falseHide} · ` +
            `false-pass ${score.falsePass} · penalty ${score.penalty} · ` +
            `${score.meanLatency}ms/call · ${score.ruleHits} caught by rules`
        );
        score.misses.forEach((m) =>
          log(`   MISS ${m.label.padEnd(26)} want ${m.want} got ${m.got}${m.viaRule ? ` [rule ${m.viaRule}]` : ` | ${m.raw.slice(0, 40)}`}`)
        );
      }
    }

    log("\n\n===== SUMMARY (lower penalty is better; false-hide counts double) =====");
    table
      .slice()
      .sort((a, b) => penalty(a.score) - penalty(b.score) || a.score.meanLatency - b.score.meanLatency)
      .forEach((r) => log(formatScore(r.name, r.score)));

    window.__BENCH__ = table;
    log("\ndone");
  } catch (err) {
    log(`ERROR: ${err.stack || err.message || err}`);
  } finally {
    document.getElementById("run").disabled = false;
  }
}

document.getElementById("run").addEventListener("click", run);
