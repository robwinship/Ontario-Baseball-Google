const SEARCH_INDEX_PATH = "data/search-index.json";
const SEARCH_META_PATH = "data/search-meta.json";

const state = {
  docs: [],
  meta: null,
  fuse: null,
};

const resultContainer = document.getElementById("results");
const searchSummary = document.getElementById("search-summary");
const searchInput = document.getElementById("search-input");
const searchForm = document.getElementById("search-form");
const sourceCheckboxes = Array.from(document.querySelectorAll(".source-filters input[type='checkbox']"));
const cardTemplate = document.getElementById("result-card-template");

const signinForm = document.getElementById("signin-form");
const signinStatus = document.getElementById("signin-status");
const signinBtn = document.getElementById("signin-btn");

async function loadSearchData() {
  const [docsResponse, metaResponse] = await Promise.all([
    fetch(SEARCH_INDEX_PATH),
    fetch(SEARCH_META_PATH),
  ]);

  if (!docsResponse.ok || !metaResponse.ok) {
    throw new Error("Could not load index files.");
  }

  const docs = await docsResponse.json();
  const meta = await metaResponse.json();
  state.docs = Array.isArray(docs) ? docs : [];
  state.meta = meta;
  state.fuse = new Fuse(state.docs, {
    includeScore: true,
    threshold: 0.33,
    ignoreLocation: true,
    keys: [
      { name: "title", weight: 0.38 },
      { name: "keywords", weight: 0.2 },
      { name: "headings", weight: 0.17 },
      { name: "snippet", weight: 0.1 },
      { name: "searchText", weight: 0.15 },
    ],
  });
}

function selectedSources() {
  return new Set(sourceCheckboxes.filter((box) => box.checked).map((box) => box.value));
}

function groupedBySource(documents) {
  const map = new Map();
  documents.forEach((doc) => {
    const source = doc.source || "unknown";
    if (!map.has(source)) {
      map.set(source, []);
    }
    map.get(source).push(doc);
  });
  return map;
}

function sourceLabel(source) {
  if (source === "playoba") {
    return "playoba.ca";
  }
  if (source === "ondeck") {
    return "ondeck";
  }
  return source || "unknown";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMentionsInDoc(doc, query) {
  if (!query) {
    return 0;
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  if (!terms.length) {
    return 0;
  }

  const haystack = `${doc.title || ""} ${doc.snippet || ""} ${doc.searchText || ""} ${(doc.keywords || []).join(" ")}`.toLowerCase();
  let total = 0;
  for (const term of terms) {
    const pattern = new RegExp(escapeRegExp(term), "g");
    total += (haystack.match(pattern) || []).length;
  }
  return total;
}

function renderDocuments(documents, query) {
  resultContainer.innerHTML = "";

  if (!documents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = query
      ? "No matches found for this query and source selection."
      : "Index loaded. Enter a query to begin.";
    resultContainer.appendChild(empty);
    return;
  }

  const grouped = groupedBySource(documents);
  for (const [source, docs] of grouped.entries()) {
    const groupEl = document.createElement("section");
    groupEl.className = "result-group";

    const title = document.createElement("h2");
    if (query) {
      const sourceMentions = docs.reduce((sum, doc) => sum + (doc._mentions || 0), 0);
      title.textContent = `${sourceLabel(source)} (${docs.length} docs, ${sourceMentions} hits)`;
    } else {
      title.textContent = `${sourceLabel(source)} (${docs.length} docs)`;
    }
    groupEl.appendChild(title);

    docs.forEach((doc) => {
      const fragment = cardTemplate.content.cloneNode(true);
      const link = fragment.querySelector("a");
      const badge = fragment.querySelector(".source-badge");
      const snippet = fragment.querySelector(".snippet");
      const meta = fragment.querySelector(".meta");

      badge.textContent = sourceLabel(doc.source);
      link.textContent = doc.title || doc.url;
      link.href = doc.url;
      snippet.textContent = doc.snippet || "No snippet available.";

      const freshness = doc.updatedAt ? `Updated ${new Date(doc.updatedAt).toLocaleString()}` : "Updated time unavailable";
      const mentions = Number.isFinite(doc._mentions) && doc._mentions > 0 ? ` | Mentions: ${doc._mentions}` : "";
      meta.textContent = `${freshness}${mentions} | ${doc.url}`;

      groupEl.appendChild(fragment);
    });

    resultContainer.appendChild(groupEl);
  }
}

function updateSummary(query, count, mentions = 0) {
  const sourceCount = selectedSources().size;
  const freshness = state.meta?.freshness || {};
  const playobaFresh = freshness.playoba || "unknown";
  const ondeckFresh = freshness.ondeck || "unknown";
  searchSummary.textContent = query
    ? `${count} document result(s), ${mentions} mention(s), across ${sourceCount} selected source(s). playoba indexed: ${playobaFresh}. ondeck indexed: ${ondeckFresh}.`
    : `Loaded ${state.docs.length} indexed documents. playoba indexed: ${playobaFresh}. ondeck indexed: ${ondeckFresh}.`;
}

function runSearch() {
  const query = searchInput.value.trim();
  const sources = selectedSources();

  if (!query) {
    const base = state.docs.filter((doc) => sources.has(doc.source));
    updateSummary(query, base.length, 0);
    renderDocuments(base, query);
    return;
  }

  const searchHits = state.fuse.search(query).map((hit) => ({
    ...hit.item,
    _score: Number.isFinite(hit.score) ? hit.score : 1,
  }));
  const filtered = searchHits
    .filter((doc) => sources.has(doc.source))
    .map((doc) => ({ ...doc, _mentions: countMentionsInDoc(doc, query) }))
    .sort((a, b) => {
      if ((b._mentions || 0) !== (a._mentions || 0)) {
        return (b._mentions || 0) - (a._mentions || 0);
      }
      return (a._score || 1) - (b._score || 1);
    });
  const mentionTotal = filtered.reduce((sum, doc) => sum + (doc._mentions || 0), 0);
  updateSummary(query, filtered.length, mentionTotal);
  renderDocuments(filtered, query);
}

function handleSigninSubmit(event) {
  event.preventDefault();
  const authEnabled = Boolean(state.meta?.authCapabilities?.ondeckBrowserAuth);

  if (!authEnabled) {
    signinStatus.textContent =
      "Live ondeck sign-in is not enabled for this hosted version yet. Published ondeck index is still searchable.";
    return;
  }

  signinStatus.textContent = "Sign-in flow is enabled in metadata but not yet implemented in this client build.";
}

async function bootstrap() {
  try {
    signinBtn.disabled = true;
    await loadSearchData();
    signinBtn.disabled = false;
    runSearch();

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });

    sourceCheckboxes.forEach((box) => box.addEventListener("change", runSearch));
    signinForm.addEventListener("submit", handleSigninSubmit);
  } catch (error) {
    searchSummary.textContent = "Failed to load search data. Check the generated data files.";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = error.message;
    resultContainer.appendChild(empty);
  }
}

bootstrap();
