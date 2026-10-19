# LinkedIn Focus Filter

A Chrome extension (MV3) that filters the LinkedIn feed against your stated interests
using an on-device decision model. No network calls at runtime — the model ships inside the
extension.

## How it works

- `src/content.js` — runs on the feed. Conceals each post on sight, then reveals
  it only if the model says it matches your interests.
- `src/dom-ops.js` — the DOM surgery (conceal, collapse, reveal, block the feed).
  Kept free of extension and model concerns so it can be tested.
- `src/junk-filter.js` — high-precision patterns for hiring ads, award posts and
  engagement bait. Matching hides the post with no model call at all.
- `src/decision.js` — the question asked per post: a choice over your topics
  plus "something else". Picking "something else" hides the post.
- `src/offscreen.js` — hosts the model in an offscreen document.
- `src/popup.*` — mode switch (off / smart filter / block feed), status, stats.
- `src/log.*` — activity log with the full trace per post and summary graphs.

Model: Kev 0.6B (`onnx-community/kev-0.6b-ONNX`, q4f16, ~330 MB), a decision
model run with open-jev and Transformers.js on WebGPU. One forward pass returns
a probability per option; nothing is generated. Llama 3.2 1B stays in
`assets/models` only as an eval baseline.

## Setup

```sh
npm install
node fetch-model.js     # Kev (~330 MB, shipped) and Llama (~677 MB, eval only)
npm run build           # bundles into dist/
```

Load it in any Chromium browser (Chrome, Dia, Edge):

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and select the `dist/` folder.
3. Open the extension popup, set the mode to "smart filter", and type your interests.

The model needs WebGPU. Check `chrome://gpu` if the popup shows a model error.
After `npm run build`, click the reload icon on the extension card.

The model runs in an offscreen document (`src/offscreen.js`). Chrome applies
linkedin.com's CSP to WebAssembly in content scripts, and a service worker
forbids the dynamic `import()` that ONNX Runtime needs. The service worker only
creates the document. The content script then messages it directly, and one
document serves every LinkedIn tab.

## Tests

```sh
npm test
```

Runs the suite headlessly under jsdom and exits non-zero on failure. Covers the
DOM surgery, mode-switch teardown (the transitions that used to leave the feed
permanently hidden), the junk filter's safety property, and verdict parsing.

jsdom has no layout engine, so the one assertion about concealing preserving a
post's layout box is skipped there. For that, serve `test/` and open
`checks.html` in a browser:

```sh
cd test && python3 -m http.server 8790   # then open http://localhost:8790/checks.html
```

## Benchmarks

Model behaviour is measured, not guessed. The eval runs the shipped pipeline
(junk rules first, then the model) over a labelled corpus in a real Chromium
with WebGPU, via agent-browser in its own session, not your everyday browser.

```sh
npm run eval              # llama, kev and laya
npm run eval -- kev       # one backend (comma-separated list for several)
```

| Backend | Model | Size | How it decides |
|---|---|---|---|
| `llama` | Llama-3.2-1B-Instruct q4f16 (WebLLM) | ~677 MB | Generates YES/NO from a prompt. The old Safari setup, kept as a baseline. |
| `kev` | Kev-0.6B q4f16 (open-jev), **shipped** | ~330 MB | Decision model (Qwen3-0.6B base): one forward pass, a probability per option. |
| `laya` | Laya typed-decisions fp16 (`src/laya.js`) | ~850 MB | Decision model (ModernBERT-large): one pass per question. |

Kev and Laya each run the same question variants from `src/decision.js`
(`src/eval.js` lists them), so a winning variant ships by changing
`DEFAULT_OPTIONS`. Kev and Laya download from Hugging Face on the first run.

Corpus: 20 built-in cases (`src/bench-corpus.js`) plus 50 real feed posts in
`test/corpus-extra.json` (16 YES, 34 NO, 3 of them politics or war). Cases are
grouped by the interests they were labelled against.

Scoring separates the two error directions, because they don't hurt equally:
hiding a wanted post is worse than letting junk through, so `penalty` counts a
false-hide double. Rank variants by penalty, not raw accuracy.

### Current results

Measured 2026-10-18. The 50 real posts were labelled against "ai engineer,
software engineer, SDLC." with "politics, war" to avoid. The described-interest
rows use the same intent written as four `topic: description` lines (see
`DESCRIBED_INTERESTS` in `src/eval.js`).

50 real feed posts:

| Variant | Correct | False-hide | False-pass | Penalty | ms/call |
|---|---|---|---|---|---|
| **kev: described interests + described "something else" (shipped default)** | 36/50 | 1 | 13 | 15 | 149 |
| kev: described interests, plain "something else" | 40/50 | 6 | 4 | 16 | 135 |
| kev: role-word interests + described "something else" | 26/50 | 5 | 19 | 29 | 111 |
| kev: role-word interests, plain options (first Kev release) | 25/50 | 7 | 18 | 32 | 97 |
| laya: best variant (technical-depth wording + decoys) | 26/50 | 0 | 24 | 24 | 232 |
| llama-1b: shipped Safari prompt | 24/50 | 2 | 24 | 28 | 163 |

20 built-in cases: kev with the shipped default scores 20/20, laya 19/20 at
best, llama 18/20. The built-in set no longer separates the variants; the real
posts do.

What the numbers say:

- Interests written as role words ("software engineer") are the biggest
  problem: Kev files Kubernetes, GPU-serving and benchmark posts under
  "something else". Describing each topic fixes most false-hides.
- The remaining false-passes are fluff that mentions a role or a tool ("my
  band's site made with Claude", "meet our lead engineer", a thumbnail-tool ad).
- The avoid question caught all 3 politics and war posts with Kev. Laya picks an
  avoid topic at low confidence on unrelated posts, so its variants gate that
  answer at 0.6, and then it lets almost everything through.
- Confidence thresholds on YES cost more false-hides than they save.

Promoted posts never reach the model: the header rule caught 40 of 42 ads in
the logs, and the 2 misses ("Promoted by <company>") are matched now.

### Growing the eval set from real use

The corpus saturates quickly. Once several variants score perfectly it can't
tell them apart. Feed it real posts:

1. Browse LinkedIn with the filter on (or run the debug build with the
   telemetry collector, which logs every post).
2. Open the popup → **View activity log**.
3. Mark verdicts ✓ or ✗ (✗ records the opposite as the wanted answer).
4. Click **Export eval set** and merge the cases into `test/corpus-extra.json`.
5. Re-run `npm run eval`.

The file contains other people's post text from your feed. It's gitignored;
keep it local.

### Older single-purpose benchmarks

These measure the Llama baseline. Serve `test/`, then open:

- `bench-prompts.html` — prompt strategies on accuracy and latency.
- `bench.html` — input caps and token budgets.
- `bench-overhead.html` — fixed vs per-token cost of a call (~57 ms per call
  plus ~0.13 ms per character).
- `index.html` — classify a single pasted post end to end.

Findings from the Llama era that still hold for prompt wording: asking for the
verdict and a reason in one call cost 5 false-hides out of 12, and telling the
model what to exclude made it reject genuine technical content.
