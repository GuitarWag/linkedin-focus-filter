// DOM surgery for the feed, kept free of extension/storage/model concerns so
// it can be exercised against a fake feed in test/dom-ops.html.

export const PROCESSED_ATTR = "lifState"; // -> data-lif-state
export const PROCESSED_SELECTOR = "[data-lif-state]";
export const HIDDEN_SELECTOR = '[data-lif-state="hidden"]';
export const CONCEALED_SELECTOR = '[data-lif-state="hidden"], [data-lif-state="pending"]';
export const BLOCKED_SELECTOR = "[data-lif-blocked]";
export const OVERLAY_ID = "lif-block-overlay";
const VEIL_CLASS = "lif-veil";

// Conceal a post the moment we notice it, before the model has judged it, so
// nothing unwanted is ever readable. visibility:hidden (not display:none)
// keeps the post's layout box, so revealing it later shifts nothing. The veil
// re-enables its own visibility and paints over the area.
// LinkedIn labels ads with a bare "Promoted" line in the post header, or
// "Promoted by <a>Company</a>". Matching a whole text node keeps a post that
// merely says "promoted" safe; text nodes rather than leaf elements because
// the "by <company>" form splits the label across a link.
const PROMOTED_LABEL = /^(promoted|promoted by\b.*|sponsored|patrocinado|promovido|sponsoris[ée]|gesponsert)$/i;

export function isPromoted(post) {
  const walker = post.ownerDocument.createTreeWalker(post, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (PROMOTED_LABEL.test(n.nodeValue.trim())) return true;
  }
  return false;
}

export function concealPost(post) {
  if (post.dataset[PROCESSED_ATTR] === "hidden") return;
  post.dataset[PROCESSED_ATTR] = "pending";
  if (post.querySelector(`:scope > .${VEIL_CLASS}`)) return;

  post.dataset.lifPrevPosition = post.style.position || "";
  post.style.position = "relative";
  post.style.visibility = "hidden";

  const veil = document.createElement("div");
  veil.className = VEIL_CLASS;
  // Canvas/GrayText are system colours, so this follows LinkedIn's light or
  // dark theme without us tracking it.
  veil.style.cssText =
    "position:absolute;inset:0;visibility:visible;display:flex;align-items:center;" +
    "justify-content:center;background:Canvas;color:GrayText;" +
    "font:13px -apple-system,sans-serif;z-index:1;";
  veil.textContent = "Checking…";
  post.appendChild(veil);
}

function unveil(post) {
  post.querySelector(`:scope > .${VEIL_CLASS}`)?.remove();
  post.style.visibility = "";
  post.style.position = post.dataset.lifPrevPosition || "";
  delete post.dataset.lifPrevPosition;
}

// `why` finishes "Hidden by Focus Filter: ..." on the collapsed bar.
export function hidePost(post, why = "not about your topics") {
  if (post.dataset[PROCESSED_ATTR] === "hidden") return;
  unveil(post); // drop the "Checking…" state before collapsing
  post.dataset[PROCESSED_ATTR] = "hidden";

  const wrapper = document.createElement("div");
  wrapper.className = "lif-wrapped";
  while (post.firstChild) wrapper.appendChild(post.firstChild);
  wrapper.style.display = "none";

  const bar = document.createElement("div");
  bar.className = "lif-bar";
  bar.style.cssText =
    "padding:10px 16px;font:13px -apple-system,sans-serif;color:#666;display:flex;" +
    "align-items:center;justify-content:space-between;border-bottom:1px solid #e0e0e0;";
  const label = document.createElement("span");
  label.textContent = `Hidden by Focus Filter: ${why}`;
  bar.appendChild(label);
  const btn = document.createElement("button");
  btn.textContent = "Show";
  btn.style.cssText =
    "border:none;background:#0a66c2;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;";
  btn.onclick = () => revealPost(post);
  bar.appendChild(btn);

  post.appendChild(bar);
  post.appendChild(wrapper);
}

// Undo hidePost, putting the original children back where they were so we
// don't leave our wrapper div inside a subtree React owns.
export function revealPost(post) {
  unveil(post);
  const wrapper = post.querySelector(":scope > .lif-wrapped");
  post.querySelector(":scope > .lif-bar")?.remove();
  if (wrapper) {
    while (wrapper.firstChild) post.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
  }
  post.dataset[PROCESSED_ATTR] = "done";
}

// Covers both collapsed posts and ones still veiled awaiting a verdict.
export function revealAllPosts(scope = document) {
  scope.querySelectorAll(CONCEALED_SELECTOR).forEach(revealPost);
}

export function clearProcessedMarkers(scope = document) {
  scope.querySelectorAll(PROCESSED_SELECTOR).forEach((el) => {
    delete el.dataset[PROCESSED_ATTR];
  });
  // Also drop the veil-timeout retry flag, or posts shown during a slow model
  // load would never be concealed again after a mode switch.
  scope.querySelectorAll("[data-lif-retry]").forEach((el) => {
    delete el.dataset.lifRetry;
  });
}

// Hide the feed container behind an overlay. Returns true when it actually
// blocked something, false when there was nothing to do.
export function blockFeed(container, onDismiss) {
  if (!container || container.dataset.lifBlocked) return false;

  // Drop any overlay left behind by a previous (now replaced) feed root,
  // otherwise the panels stack up.
  removeOverlays();

  container.dataset.lifBlocked = "1";
  container.style.display = "none";

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    "padding:80px 20px;text-align:center;font:15px -apple-system,sans-serif;color:#666;";
  overlay.innerHTML =
    '<p style="font-size:18px;font-weight:600;color:#333;margin:0 0 8px;">Feed blocked by Focus Filter</p>' +
    '<p style="margin:0 0 20px;">Take a breath, or view it anyway for this session.</p>';
  const btn = document.createElement("button");
  btn.textContent = "Show feed for this session";
  btn.style.cssText =
    "border:none;background:#0a66c2;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;";
  btn.onclick = () => {
    onDismiss?.();
    unblockFeed();
  };
  overlay.appendChild(btn);
  container.insertAdjacentElement("afterend", overlay);
  return true;
}

export function unblockFeed(scope = document) {
  removeOverlays(scope);
  scope.querySelectorAll(BLOCKED_SELECTOR).forEach((el) => {
    el.style.display = "";
    delete el.dataset.lifBlocked;
  });
}

function removeOverlays(scope = document) {
  scope.querySelectorAll(`#${OVERLAY_ID}`).forEach((el) => el.remove());
}
