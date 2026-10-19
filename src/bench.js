// Latency/verdict benchmark for classification settings, run against real
// post text pulled from the actual feed. Open test/bench.html.
import { CreateMLCEngine } from "@mlc-ai/web-llm";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const INTERESTS = "software engineer, ai, sql, cloud";

// Real posts from the feed, with the verdict a human would want.
const POSTS = [
  {
    label: "architect-course-spam",
    want: "NO",
    text: `Senior Developer? Your career GPS is lying to you 📍 It keeps routing you through the same loop: New framework. New job. Same role. Estimated arrival at career satisfaction: Never. But there's a route your GPS doesn't show you. The one that the architects currently working at fortune 500 companies took to escape the developer loop. Direct path. No detours. 15 weeks to destination. 🏃💨 Forget the endless loop of lateral moves and tiny raises. The architect route delivers what job-hopping never will: A salary that actually transforms your life. Our Software Architecture Course is the route recalculation you've been looking for. In our course, you will learn from Fortune 500 architects who know the road, having traveled it themselves. Your current path: 40+ years of loops. The architect path: 15 weeks direct 🎯 Limited seats available only to experienced senior developers. Then click here to learn more 👇`,
  },
  {
    label: "big-o-notation",
    want: "YES",
    text: `⏱️ Big-O Notation, finally explained without the headache. If DSA techniques are the "how," Big-O is the "how fast." It's the language we use to describe how your code scales as the input grows — and it's the #1 thing interviewers listen for. Here's the complexity ladder, from best to worst 👇 🟢 O(1) — Constant: Same effort no matter the input size. → Accessing an array index, hash map lookup. 🟢 O(log n) — Logarithmic: You cut the problem in half each step. → Binary search. 🟡 O(n) — Linear: Effort grows in step with the input. → A single loop through an array. 🟡 O(n log n) — Log-linear: The gold standard for efficient sorting. → Merge sort, quick sort, heap sort. 🟠 O(n²) — Quadratic: A loop inside a loop. 🔴 O(2ⁿ) — Exponential: Doubles with every added element. #DSA #BigO #TimeComplexity #Algorithms`,
  },
  {
    label: "workplace-safety-pt",
    want: "NO",
    text: `A armadilha do hábito - Quando o risco vira rotina. Ver alguém sobre uma viga suspensa assusta, mas esse comportamento quase nunca vem do desejo de se ferir. Ele nasce de falhas cognitivas e pressões silenciosas da mente humana. Normalização do desvio: "Fiz assim antes e nada aconteceu" transforma o erro em rotina. Viés do imediatismo: A pressa em cumprir prazos faz o cérebro trocar a segurança pela solução mais rápida. Regras e placas não mudam comportamentos, elas apenas delimitam fronteiras. #SegurancaComportamental #FatorHumano`,
  },
  {
    label: "festival-promo-pt",
    want: "NO",
    text: `110 mil pessoas presentes no MEO KALORAMA! 💙 E como naming sponsor, a MEO garantiu que todos os festivaleiros estavam conectados no Parque da Bela Vista, ao longo dos 3 dias de festival. ✨ Deslize para ver os números! 👉 #MEO #WeAreMEOKALORAMA #FestivalMEO #MEOKALORAMASemFalha #FundacaoMEO`,
  },
  {
    label: "ai-as-infrastructure",
    want: "YES",
    text: `I thought I understood AI. I didn't. I'd used ChatGPT, Claude, built workflows and automated bits of work, so I thought I had a decent handle on where it was all going. Then I started giving it a serious amount of time, and that's when it really changed. The gap between casually using AI and actually building around it is enormous. Research, analysis, recruitment, operations, systems - once you start going deeper, you realise just how much capability is sitting there. And then you get to agents, which honestly feels like a different category altogether. That's when you stop thinking about AI as a tool and start thinking about it as infrastructure.`,
  },
  {
    label: "hiring-post",
    want: "NO",
    text: `We're hiring! 🚀 Our team is growing and we're looking for talented people to join us. Multiple openings across engineering, product and design. Great culture, competitive salary, remote friendly. If you're passionate about building great products, DM me or apply through the link below. Please share with your network! #hiring #jobs #opportunity`,
  },
  {
    label: "motivational",
    want: "NO",
    text: `5 years ago I was rejected from 47 interviews. Today I lead a team of 30. Here's what I learned: 1. Rejection is redirection. 2. Your network is your net worth. 3. Consistency beats talent. 4. Never stop learning. 5. Believe in yourself even when nobody else does. The only person who can stop you is you. Agree? ♻️ Repost to inspire someone today.`,
  },
  {
    label: "postgres-deep-dive",
    want: "YES",
    text: `Spent the week tuning a Postgres query that was taking 45 seconds. Turned out the planner was choosing a nested loop join over a hash join because the statistics on the partitioned table were stale. Ran ANALYZE, bumped default_statistics_target to 500 on the hot columns, and added a covering index on (tenant_id, created_at) INCLUDING (status). Down to 180ms. Lesson: before you reach for a read replica or a cache layer, read the EXPLAIN ANALYZE output properly. The planner usually tells you exactly what it got wrong.`,
  },
];

const VARIANTS = [
  { name: "A current (1200 chars, 30 tok, long prompt)", chars: 1200, maxTokens: 30, prompt: "long" },
  { name: "B 400 chars, 30 tok, long prompt", chars: 400, maxTokens: 30, prompt: "long" },
  { name: "C 400 chars, 16 tok, long prompt", chars: 400, maxTokens: 16, prompt: "long" },
  { name: "D 400 chars, 16 tok, short prompt", chars: 400, maxTokens: 16, prompt: "short" },
  { name: "E 400 chars, 4 tok, short prompt (no reason)", chars: 400, maxTokens: 4, prompt: "short" },
];

function systemPrompt(kind, interests) {
  if (kind === "short") {
    return (
      `Reader's interests: ${interests}. Answer YES only if the post is specifically about one of them. ` +
      `Buzzword mentions, career/motivational/hiring posts and hype are NO. Unsure means NO. ` +
      `Reply "YES: <5 words>" or "NO: <5 words>".`
    );
  }
  return (
    `You are a strict content filter for a social feed. The reader's interests are: ${interests}. ` +
    `Default to NO. Only answer YES if the post is substantively and specifically about one of these ` +
    `interests — a passing buzzword, a generic career or motivational post, a job/hiring post, or vague ` +
    `hype does not count as YES. When unsure, answer NO. Reply on one line in the exact form ` +
    `"YES: <reason in under 10 words>" or "NO: <reason in under 10 words>".`
  );
}

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

async function classifyOnce(variant, post) {
  const started = performance.now();
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt(variant.prompt, INTERESTS) },
      { role: "user", content: post.text.slice(0, variant.chars) },
    ],
    max_tokens: variant.maxTokens,
    temperature: 0,
  });
  const latencyMs = Math.round(performance.now() - started);
  const raw = reply.choices[0]?.message?.content?.trim() ?? "";
  const m = raw.match(/^(YES|NO)\s*:?\s*(.*)$/i);
  const answer = (m?.[1] ?? raw).toUpperCase().startsWith("YES") ? "YES" : "NO";
  return { answer, raw, latencyMs };
}

async function run() {
  document.getElementById("run").disabled = true;
  try {
    if (!engine) await loadEngine();

    log("warmup…");
    await classifyOnce(VARIANTS[0], POSTS[0]);

    const table = [];
    for (const variant of VARIANTS) {
      const latencies = [];
      let correct = 0;
      const verdicts = [];
      for (const post of POSTS) {
        const r = await classifyOnce(variant, post);
        latencies.push(r.latencyMs);
        if (r.answer === post.want) correct++;
        verdicts.push(`${r.answer === post.want ? "ok " : "MISS"} ${post.label}: ${r.raw.replace(/\n/g, " ")}`);
      }
      const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const total = latencies.reduce((a, b) => a + b, 0);
      table.push({ variant: variant.name, mean, total, correct, of: POSTS.length });
      log(`\n=== ${variant.name}`);
      log(`mean ${mean}ms · total ${total}ms · agrees with human ${correct}/${POSTS.length}`);
      verdicts.forEach((v) => log("   " + v));
    }

    log("\n\n===== SUMMARY =====");
    table.forEach((r) =>
      log(`${String(r.mean).padStart(6)}ms mean  ${String(r.correct)}/${r.of} correct   ${r.variant}`)
    );
    window.__BENCH__ = table;
    log("\ndone");
  } catch (err) {
    log(`ERROR: ${err.stack || err.message || err}`);
  } finally {
    document.getElementById("run").disabled = false;
  }
}

document.getElementById("run").addEventListener("click", run);
