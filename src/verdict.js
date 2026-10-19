// Parsing the model's verdict. The model often answers in the language of the
// post it just read ("Não." for a Portuguese post), so an English-only check
// would silently misread those — it happened to land on NO by accident, but a
// Portuguese YES would have been read as NO.
// Note the Unicode-aware boundary: \b is ASCII-only, so `sí` followed by
// end-of-string failed \b because í isn't an ASCII word character. The
// lookahead instead just requires that no further letter or digit follows,
// which keeps "Yesterday" and "Java" from reading as yes.
const AFFIRMATIVE =
  /^[^\p{L}\p{N}]*(yes|yeah|yep|sure|sim|ja|oui|sí|si|да|はい|correct|true)(?![\p{L}\p{N}])/iu;

// Anything that isn't a recognisable yes is treated as no: the filter fails
// closed, which is the safer direction for "only show what I asked for".
export function parseVerdict(raw) {
  if (typeof raw !== "string") return "NO";
  return AFFIRMATIVE.test(raw.trim()) ? "YES" : "NO";
}
