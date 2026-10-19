// The check suite. Runs headlessly under jsdom via `npm test`, and in a real
// browser via test/checks.html (which also exercises the layout assertions
// jsdom can't model). Covers the feed DOM surgery, the mode-switch
// round-trips that used to leave the feed hidden or stack up block overlays,
// the junk pre-filter's safety property, and verdict parsing.
import {
  blockFeed,
  clearProcessedMarkers,
  concealPost,
  hidePost,
  isPromoted,
  revealAllPosts,
  revealPost,
  unblockFeed,
} from "./dom-ops.js";
import { DEFAULT_OPTIONS, buildQuestions, judge, topics } from "./decision.js";
import { matchJunkRule } from "./junk-filter.js";
import { parseVerdict } from "./verdict.js";
import { POSTS } from "./bench-corpus.js";
import { evaluate, groupByInterests, penalty } from "./eval-harness.js";

export function runChecks({ layoutAvailable = true } = {}) {
  const results = [];

  function check(name, fn, opts = {}) {
    if (opts.needsLayout && !layoutAvailable) {
      results.push({ name, ok: true, skipped: "needs real layout" });
      return;
    }
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String(err.message || err) });
    }
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function buildFeed(postCount = 3) {
    document.getElementById("fixture")?.remove();
    const fixture = document.createElement("div");
    fixture.id = "fixture";
    const feed = document.createElement("div");
    feed.setAttribute("data-testid", "mainFeed");
    for (let i = 0; i < postCount; i++) {
      const post = document.createElement("div");
      post.setAttribute("componentkey", `update-card-focus-${i}`);
      const text = document.createElement("span");
      text.setAttribute("data-testid", "expandable-text-box");
      text.textContent = `post ${i} body`;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `meta ${i}`;
      post.append(text, meta);
      feed.appendChild(post);
    }
    fixture.appendChild(feed);
    document.body.appendChild(fixture);
    return { fixture, feed, posts: [...feed.children] };
  }

  // --- hide / reveal round-trip -----------------------------------------

  check("hidePost hides content but keeps children", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    hidePost(post);
    assert(post.dataset.lifState === "hidden", "state should be hidden");
    assert(post.querySelector(".lif-bar"), "bar should be inserted");
    const wrapper = post.querySelector(".lif-wrapped");
    assert(wrapper, "wrapper should exist");
    assert(wrapper.style.display === "none", "wrapper should be display:none");
    assert(wrapper.children.length === 2, "original children preserved in wrapper");
  });

  check("revealPost restores the original DOM shape", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    const before = post.innerHTML;
    hidePost(post);
    revealPost(post);
    assert(!post.querySelector(".lif-bar"), "bar removed");
    assert(!post.querySelector(".lif-wrapped"), "wrapper unwrapped");
    assert(post.innerHTML === before, `innerHTML restored\n  was: ${before}\n  now: ${post.innerHTML}`);
    assert(post.dataset.lifState === "done", "state should be done");
  });

  check("hidePost is idempotent (no double wrapping)", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    hidePost(post);
    hidePost(post);
    assert(post.querySelectorAll(".lif-wrapped").length === 1, "only one wrapper");
    assert(post.querySelectorAll(".lif-bar").length === 1, "only one bar");
  });

  check("the Show button reveals the post", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    hidePost(post);
    post.querySelector(".lif-bar button").click();
    assert(!post.querySelector(".lif-wrapped"), "wrapper gone after clicking Show");
    assert(post.textContent.includes("post 0 body"), "text visible again");
  });

  check("revealAllPosts restores every hidden post (filter -> off)", () => {
    const { posts } = buildFeed(3);
    posts.forEach(hidePost);
    revealAllPosts();
    assert(document.querySelectorAll('[data-lif-state="hidden"]').length === 0, "none left hidden");
    posts.forEach((p, i) => {
      assert(p.textContent.includes(`post ${i} body`), `post ${i} visible`);
      assert(!p.querySelector(".lif-wrapped"), `post ${i} unwrapped`);
    });
  });

  check("clearProcessedMarkers wipes state so posts get re-evaluated", () => {
    const { posts } = buildFeed(2);
    posts.forEach(hidePost);
    revealAllPosts();
    clearProcessedMarkers();
    assert(document.querySelectorAll("[data-lif-state]").length === 0, "no markers left");
  });

  check("clearProcessedMarkers also drops the veil-timeout retry flag", () => {
    const { posts } = buildFeed(2);
    // What the veil timeout leaves behind when it gives up on a slow model.
    posts[0].dataset.lifRetry = "1";
    posts[0].dataset.lifState = "pending";
    clearProcessedMarkers();
    assert(
      document.querySelectorAll("[data-lif-retry]").length === 0,
      "retry flag must not survive a mode switch, or the post is never concealed again"
    );
  });

  // --- conceal-first (hide on sight, reveal after verdict) --------------

  check("concealPost hides content immediately and marks it pending", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    concealPost(post);
    assert(post.dataset.lifState === "pending", "state should be pending");
    assert(post.style.visibility === "hidden", "post content hidden");
    const veil = post.querySelector(".lif-veil");
    assert(veil, "veil inserted");
    assert(veil.style.visibility === "visible", "veil itself stays visible");
    assert(veil.textContent.includes("Checking"), "veil explains itself");
  });

  check(
    "concealing preserves the post's layout box (no scroll jank)",
    () => {
      const { posts } = buildFeed(1);
      const post = posts[0];
      const before = post.getBoundingClientRect().height;
      assert(before > 0, "post should have height to begin with");
      concealPost(post);
      const during = post.getBoundingClientRect().height;
      assert(
        Math.abs(during - before) < 1,
        `height must not change while veiled (was ${before}, now ${during})`
      );
    },
    { needsLayout: true }
  );

  check("concealPost is idempotent (one veil only)", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    concealPost(post);
    concealPost(post);
    assert(post.querySelectorAll(".lif-veil").length === 1, "only one veil");
  });

  check("reveal after a YES restores the post exactly", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    const before = post.innerHTML;
    concealPost(post);
    revealPost(post);
    assert(post.innerHTML === before, "original markup restored");
    assert(post.style.visibility === "", "visibility restored");
    assert(!post.querySelector(".lif-veil"), "veil removed");
    assert(post.dataset.lifState === "done", "state done");
  });

  check("a NO collapses a veiled post without leaving the veil behind", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    concealPost(post);
    hidePost(post);
    assert(!post.querySelector(".lif-veil"), "veil gone");
    assert(post.style.visibility === "", "visibility handed to the wrapper");
    assert(post.querySelector(".lif-bar"), "filtered bar present");
    assert(post.querySelector(".lif-wrapped").style.display === "none", "content collapsed");
    assert(post.dataset.lifState === "hidden", "state hidden");
  });

  check("revealAllPosts also frees posts still awaiting a verdict", () => {
    const { posts } = buildFeed(3);
    concealPost(posts[0]);
    concealPost(posts[1]);
    hidePost(posts[2]);
    revealAllPosts();
    posts.forEach((p, i) => {
      assert(!p.querySelector(".lif-veil"), `post ${i} unveiled`);
      assert(p.style.visibility === "", `post ${i} visible`);
      assert(p.textContent.includes(`post ${i} body`), `post ${i} readable`);
    });
  });

  check("preserves an existing inline position on the post", () => {
    const { posts } = buildFeed(1);
    const post = posts[0];
    post.style.position = "absolute";
    concealPost(post);
    assert(post.style.position === "relative", "veil needs a positioned parent");
    revealPost(post);
    assert(post.style.position === "absolute", "original position restored");
  });

  // --- block / unblock round-trip ---------------------------------------

  check("blockFeed hides the feed and shows one overlay", () => {
    const { feed } = buildFeed(2);
    const blocked = blockFeed(feed);
    assert(blocked === true, "should report it blocked");
    assert(feed.style.display === "none", "feed hidden");
    assert(feed.dataset.lifBlocked === "1", "feed marked blocked");
    assert(document.querySelectorAll("#lif-block-overlay").length === 1, "exactly one overlay");
  });

  check("blockFeed twice does not stack overlays", () => {
    const { feed } = buildFeed(2);
    blockFeed(feed);
    const second = blockFeed(feed);
    assert(second === false, "second call is a no-op");
    assert(document.querySelectorAll("#lif-block-overlay").length === 1, "still one overlay");
  });

  check("unblockFeed fully restores the feed (block -> off)", () => {
    const { feed } = buildFeed(2);
    blockFeed(feed);
    unblockFeed();
    assert(feed.style.display === "", "feed visible again");
    assert(feed.dataset.lifBlocked === undefined, "blocked marker cleared");
    assert(document.querySelectorAll("#lif-block-overlay").length === 0, "overlay removed");
  });

  check("a replaced feed root does not leak a second overlay", () => {
    const { fixture, feed } = buildFeed(2);
    blockFeed(feed);

    // Simulate LinkedIn's SPA swapping the whole feed container out.
    const replacement = document.createElement("div");
    replacement.setAttribute("data-testid", "mainFeed");
    fixture.replaceChild(replacement, feed);

    blockFeed(replacement);
    assert(document.querySelectorAll("#lif-block-overlay").length === 1, "exactly one overlay");
    assert(replacement.style.display === "none", "new root is hidden");
  });

  check("dismiss callback fires and unblocks", () => {
    const { feed } = buildFeed(1);
    let dismissed = false;
    blockFeed(feed, () => {
      dismissed = true;
    });
    document.querySelector("#lif-block-overlay button").click();
    assert(dismissed, "onDismiss called");
    assert(document.querySelectorAll("#lif-block-overlay").length === 0, "overlay removed");
    assert(feed.style.display === "", "feed shown");
  });

  // --- mode transitions, in the order applyMode/teardown perform them ---

  const leaveFilter = () => {
    revealAllPosts();
    clearProcessedMarkers();
  };
  const leaveBlock = () => unblockFeed();

  check("off -> filter -> block -> off leaves no residue", () => {
    const { feed, posts } = buildFeed(3);
    const original = posts.map((p) => p.innerHTML);

    // filter: conceal on sight, one verdict each way
    posts.forEach(concealPost);
    revealPost(posts[0]);
    hidePost(posts[1]);
    // posts[2] still awaiting a verdict when the mode changes

    // -> block
    leaveFilter();
    blockFeed(feed);
    assert(document.querySelectorAll("#lif-block-overlay").length === 1, "blocked once");

    // -> off
    leaveBlock();

    assert(feed.style.display === "", "feed visible");
    assert(document.querySelectorAll("#lif-block-overlay").length === 0, "no overlay");
    assert(document.querySelectorAll("[data-lif-blocked]").length === 0, "no blocked marker");
    assert(document.querySelectorAll("[data-lif-state]").length === 0, "no post markers");
    assert(document.querySelectorAll(".lif-veil, .lif-wrapped, .lif-bar").length === 0, "no injected nodes");
    posts.forEach((p, i) => {
      assert(p.style.visibility === "", `post ${i} visible`);
      assert(p.innerHTML === original[i], `post ${i} markup restored`);
    });
  });

  check("block -> filter restores the feed before filtering starts", () => {
    const { feed, posts } = buildFeed(2);
    blockFeed(feed);
    leaveBlock();
    posts.forEach(concealPost);

    assert(feed.style.display === "", "feed must be visible for filtering to make sense");
    assert(document.querySelectorAll("#lif-block-overlay").length === 0, "overlay gone");
    assert(document.querySelectorAll('[data-lif-state="pending"]').length === 2, "both posts veiled");
  });

  check("leaving filter mid-flight reveals posts that never got a verdict", () => {
    const { posts } = buildFeed(3);
    posts.forEach(concealPost);
    leaveFilter();
    posts.forEach((p, i) => {
      assert(p.style.visibility === "", `post ${i} not left invisible`);
      assert(p.textContent.includes(`post ${i} body`), `post ${i} readable`);
    });
  });

  // --- junk pre-filter --------------------------------------------------

  check("decision: comma or per-line topics, with optional descriptions", () => {
    assert(topics("ai engineer, software engineer, SDLC.").join("|") === "ai engineer|software engineer|SDLC", "comma list");
    const [main, avoid] = buildQuestions("AI engineering: LLMs, agents\nDevOps: k8s", "politics, war", {
      ...DEFAULT_OPTIONS,
      otherDescription: "ads",
    });
    assert(main.options.join("|") === "AI engineering|DevOps|something else", "labels only in options");
    assert(main.descriptions["AI engineering"] === "LLMs, agents", "description kept, commas and all");
    assert(main.descriptions["something else"] === "ads", "other description");
    assert(avoid.options.join("|") === "politics|war|none of these", "avoid question");
  });

  check("decision: an avoid hit hides even a matching post", () => {
    const yes = judge("a, b", [{ choice: "a", confidence: 0.9 }]);
    const avoided = judge("a, b", [{ choice: "a", confidence: 0.9 }, { choice: "war", confidence: 0.8 }]);
    const gated = judge("a, b", [{ choice: "a", confidence: 0.9 }, { choice: "war", confidence: 0.4 }], {
      ...DEFAULT_OPTIONS,
      avoidMinConfidence: 0.6,
    });
    assert(yes.answer === "YES", "match shows");
    assert(avoided.answer === "NO" && avoided.reason === "avoid: war", "avoid hides");
    assert(gated.answer === "YES", "a weak avoid answer is ignored when gated");
  });

  check("isPromoted spots the header label, not the word in a post", () => {
    const ad = document.createElement("div");
    ad.innerHTML = "<div><span>Acme Corp</span><span>Promoted</span></div><p>Try our product</p>";
    const post = document.createElement("div");
    post.innerHTML = "<div><span>Jane Doe</span></div><p>I got promoted to staff engineer. Promoted at last!</p>";
    const ptAd = document.createElement("div");
    ptAd.innerHTML = "<span> Promovido </span><p>Abra conta</p>";
    assert(isPromoted(ad), "English ad label");
    assert(!isPromoted(post), "a post about being promoted");
    assert(isPromoted(ptAd), "Portuguese ad label");
    const byAd = document.createElement("div");
    byAd.innerHTML = "<span>Mads • 2nd</span><span>Promoted by <a>Parahelp</a></span><p>If a tool…</p>";
    assert(isPromoted(byAd), '"Promoted by" with the company as a link');
  });

  check("junk rules never fire on wanted content", () => {
    const wanted = POSTS.filter((p) => p.want === "YES");
    assert(wanted.length >= 4, "corpus should have several wanted posts");
    for (const post of wanted) {
      const rule = matchJunkRule(post.text);
      assert(!rule, `rule "${rule}" wrongly matched wanted post "${post.label}"`);
    }
  });

  check("junk rules catch the posts the model lets through", () => {
    const expectCaught = ["architect-course-spam", "hiring-post", "motivational", "company-award"];
    for (const label of expectCaught) {
      const post = POSTS.find((p) => p.label === label);
      assert(post, `corpus missing ${label}`);
      assert(matchJunkRule(post.text), `no rule matched junk post "${label}"`);
    }
  });

  check("junk rules leave ordinary off-topic posts to the model", () => {
    // book-recommendation is deliberately absent: it ends in "drop it in the
    // comments", so the engagement-bait rule claiming it is correct (want: NO).
    for (const label of ["workplace-safety-pt", "festival-promo-pt"]) {
      const post = POSTS.find((p) => p.label === label);
      assert(post, `corpus missing ${label}`);
      assert(!matchJunkRule(post.text), `rule should not claim "${label}"`);
    }
  });

  // --- verdict parsing --------------------------------------------------

  check("parseVerdict reads plain English answers", () => {
    assert(parseVerdict("YES") === "YES", "YES");
    assert(parseVerdict("yes") === "YES", "lowercase");
    assert(parseVerdict("  Yes. ") === "YES", "padded and punctuated");
    assert(parseVerdict("YES: postgres tuning") === "YES", "verdict with trailing reason");
    assert(parseVerdict("NO") === "NO", "NO");
    assert(parseVerdict("No.") === "NO", "punctuated no");
  });

  check("parseVerdict handles the model replying in the post's language", () => {
    // This was silently landing on NO by luck before parseVerdict existed.
    assert(parseVerdict("Sim") === "YES", "portuguese yes");
    assert(parseVerdict("Sim.") === "YES", "portuguese yes punctuated");
    assert(parseVerdict("Sí") === "YES", "spanish yes");
    assert(parseVerdict("Oui") === "YES", "french yes");
    assert(parseVerdict("Não.") === "NO", "portuguese no");
    assert(parseVerdict("Nein") === "NO", "german no");
  });

  check("parseVerdict fails closed on junk output", () => {
    assert(parseVerdict("") === "NO", "empty");
    assert(parseVerdict("   ") === "NO", "whitespace");
    assert(parseVerdict(undefined) === "NO", "undefined");
    assert(parseVerdict(null) === "NO", "null");
    assert(parseVerdict("I'm not sure about this one") === "NO", "waffle");
    assert(parseVerdict("Maybe") === "NO", "maybe");
  });

  check("parseVerdict does not match yes inside another word", () => {
    assert(parseVerdict("Yesterday's post about SQL") === "NO", "yesterday is not yes");
    assert(parseVerdict("Java is mentioned") === "NO", "ja must not match Java");
  });

  // --- eval harness scoring ---------------------------------------------
  // A scoring bug would quietly mislead every prompt comparison, so the
  // harness gets checked with a stub model instead of the real one.

  const stubModel = (answers) => {
    let i = 0;
    return async () => answers[i++] ?? "NO";
  };

  const asyncChecks = [];
  const checkAsync = (name, fn) => {
    asyncChecks.push(
      fn().then(
        () => results.push({ name, ok: true }),
        (err) => results.push({ name, ok: false, error: String(err.message || err) })
      )
    );
  };

  const plain = { name: "stub", maxTokens: 8, chars: 800, system: () => "sys" };

  checkAsync("evaluate counts a clean sweep as all correct", async () => {
    const cases = [
      { label: "a", want: "YES", text: "a deep dive into postgres query planning" },
      { label: "b", want: "NO", text: "some thoughts on the weather today" },
    ];
    const score = await evaluate({
      cases,
      strategy: plain,
      interests: "sql",
      callModel: stubModel(["YES", "NO"]),
    });
    assert(score.correct === 2, `expected 2 correct, got ${score.correct}`);
    assert(score.falseHide === 0 && score.falsePass === 0, "no errors expected");
    assert(score.penalty === 0, "penalty should be zero");
    assert(score.modelCalls === 2, "both cases should hit the model");
  });

  checkAsync("evaluate separates false-hide from false-pass", async () => {
    const cases = [
      { label: "wanted", want: "YES", text: "postgres query planner internals" },
      { label: "unwanted", want: "NO", text: "thoughts on the weather today" },
    ];
    const score = await evaluate({
      cases,
      strategy: plain,
      interests: "sql",
      callModel: stubModel(["NO", "YES"]),
    });
    assert(score.falseHide === 1, `expected 1 false-hide, got ${score.falseHide}`);
    assert(score.falsePass === 1, `expected 1 false-pass, got ${score.falsePass}`);
    assert(score.misses.length === 2, "both misses recorded");
  });

  checkAsync("penalty weights hiding wanted content above letting junk through", async () => {
    const base = { label: "x", text: "postgres query planner internals" };
    const hideScore = await evaluate({
      cases: [{ ...base, want: "YES" }],
      strategy: plain,
      interests: "sql",
      callModel: stubModel(["NO"]),
    });
    const passScore = await evaluate({
      cases: [{ ...base, want: "NO" }],
      strategy: plain,
      interests: "sql",
      callModel: stubModel(["YES"]),
    });
    assert(
      penalty(hideScore) > penalty(passScore),
      `false-hide (${penalty(hideScore)}) must cost more than false-pass (${penalty(passScore)})`
    );
  });

  checkAsync("evaluate applies junk rules before spending a model call", async () => {
    const cases = [
      { label: "junk", want: "NO", text: "We're hiring! Multiple openings, apply now. #hiring" },
    ];
    let called = false;
    const score = await evaluate({
      cases,
      strategy: plain,
      interests: "sql",
      callModel: async () => {
        called = true;
        return "YES";
      },
    });
    assert(!called, "model must not be called when a rule matches");
    assert(score.ruleHits === 1, "rule hit should be counted");
    assert(score.correct === 1, "rule verdict should be correct here");
  });

  checkAsync("junk rules can be disabled to measure the model alone", async () => {
    const cases = [
      { label: "junk", want: "NO", text: "We're hiring! Multiple openings, apply now. #hiring" },
    ];
    const score = await evaluate({
      cases,
      strategy: plain,
      interests: "sql",
      useJunkRules: false,
      callModel: stubModel(["YES"]),
    });
    assert(score.ruleHits === 0, "no rules should fire");
    assert(score.falsePass === 1, "model's mistake should be visible");
  });

  check("groupByInterests keeps differently-labelled cases apart", () => {
    const groups = groupByInterests([
      { label: "a", want: "YES", text: "x", interests: "sql, cloud" },
      { label: "b", want: "NO", text: "y", interests: "sql, cloud" },
      { label: "c", want: "YES", text: "z", interests: "woodworking" },
    ]);
    assert(groups.size === 2, `expected 2 groups, got ${groups.size}`);
    assert(groups.get("sql, cloud").length === 2, "two cases in the first group");
    assert(groups.get("woodworking").length === 1, "one case in the second group");
  });

  return Promise.all(asyncChecks).then(() => {
    document.getElementById("fixture")?.remove();
    return results;
  });
}

export function summarise(results) {
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  const head =
    `${results.length - failed.length}/${results.length} passed` +
    (skipped.length ? ` (${skipped.length} skipped)` : "");
  const body = results
    .map((r) => {
      if (r.skipped) return `SKIP  ${r.name} — ${r.skipped}`;
      return `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.error}`}`;
    })
    .join("\n");
  return { head, body, failedCount: failed.length, text: `${head}\n\n${body}` };
}
