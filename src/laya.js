// Laya (Convai, ModernBERT-large + decision head) for the eval, through
// Transformers.js. open-jev doesn't speak Laya's input format, so this ports
// `build_head` / `build_sequence` and the temperature lookup from laya.common
// and laya.agent (github.com/NandhaKishorM/laya). Takes the same question
// objects as Kev ({type, instructions, options}) and returns the same answer
// shape ({choice, confidence}), so decision.js judges both identically.
import { AutoConfig, AutoTokenizer, PreTrainedModel, Tensor } from "@huggingface/transformers";

export const LAYA_REPO = "onnx-community/laya-typed-decisions-ONNX";
const QTYPES = { choice: 0, score: 1, noul: 2 };
const MAX_OPTION_TOKENS = 48;

export async function loadLaya({ onProgress } = {}) {
  const config = await AutoConfig.from_pretrained(LAYA_REPO);
  const cfg = config.laya;
  const tok = await AutoTokenizer.from_pretrained(LAYA_REPO);
  const model = await PreTrainedModel.from_pretrained(LAYA_REPO, {
    config,
    dtype: "fp16",
    device: "webgpu",
    progress_callback: (p) => p.status === "progress_total" && onProgress?.(p.progress / 100),
  });

  const encode = (text) => Array.from(tok(text, { add_special_tokens: false }).input_ids.data, Number);
  const special = (token) => {
    const ids = encode(token);
    if (ids.length !== 1) throw new Error(`tokenizer does not know ${token}`);
    return ids[0];
  };
  const CLS = special("[CLS]"), SEP = special("[SEP]"), MASK = special("[MASK]");
  const scrub = (s) => s.replaceAll("[MASK]", " ");

  // laya.common.build_head: [CLS] "<type> question: <ins>" [SEP] ([MASK] opt)* [SEP]
  function buildHead(q) {
    // laya.common.render_options: "label: description" when one is given.
    const rendered = q.options.map((o) => (q.descriptions?.[o] ? `${o}: ${q.descriptions[o]}` : o));
    const opts = rendered.map((o) => [MASK, ...encode(" " + scrub(o)).slice(0, MAX_OPTION_TOKENS)]);
    let headIds = encode(`${q.type} question: ${scrub(q.instructions)}`);
    let optIds = opts;
    let budget = cfg.head_max_len - optIds.reduce((n, o) => n + o.length, 0);
    if (budget < 16) {
      const per = Math.max(4, Math.floor((cfg.head_max_len - 16) / Math.max(1, optIds.length)));
      optIds = optIds.map((o) => o.slice(0, per));
      budget = cfg.head_max_len - optIds.reduce((n, o) => n + o.length, 0);
    }
    headIds = headIds.slice(0, Math.max(8, budget));
    const ids = [CLS, ...headIds, SEP];
    const markers = [];
    for (const o of optIds) {
      markers.push(ids.length);
      ids.push(...o);
    }
    ids.push(SEP);
    return { ids, markers };
  }

  // laya.common.build_sequence: head, then as much state as fits, then [SEP].
  function buildSequence(state, q) {
    const { ids, markers } = buildHead(q);
    const room = Math.max(0, cfg.max_len - ids.length - 1);
    const all = [...ids, ...encode(scrub(state)).slice(0, room), SEP].slice(0, cfg.max_len);
    return { ids: all, markers: markers.filter((m) => m < cfg.max_len) };
  }

  // laya.agent._decode_answers: per-bucket temperature, else per-type, clamped.
  function temperature(type, k) {
    const size = k <= 2 ? "2" : k <= 5 ? "3-5" : k <= 10 ? "6-10" : "11+";
    const t = cfg.temperature_by_options[`${type}:${size}`] ?? cfg.temperature[QTYPES[type]];
    const [lo, hi] = cfg.temperature_clamp;
    return Math.min(hi, Math.max(lo, t));
  }

  const i64 = (arr) => new Tensor("int64", BigInt64Array.from(arr, BigInt), [1, arr.length]);

  async function decide(state, questions) {
    const answers = [];
    // One forward pass per question: Laya encodes each question as its own row.
    for (const q of questions) {
      const { ids, markers } = buildSequence(state, q);
      const out = await model({
        input_ids: i64(ids),
        attention_mask: i64(ids.map(() => 1)),
        marker_pos: i64(markers),
        marker_mask: new Tensor("bool", Uint8Array.from(markers, () => 1), [1, markers.length]),
        qtype: new Tensor("int64", BigInt64Array.from([BigInt(QTYPES[q.type])]), [1]),
      });
      const logits = Array.from(out.logits.data, Number).slice(0, markers.length);
      const t = temperature(q.type, markers.length);
      const max = Math.max(...logits);
      const exp = logits.map((z) => Math.exp((z - max) / t));
      const sum = exp.reduce((a, b) => a + b, 0);
      const p = exp.map((e) => e / sum);
      const best = p.indexOf(Math.max(...p));
      answers.push({ type: "choice", choice: q.options[best], confidence: p[best] });
    }
    return answers;
  }

  return { decide };
}
