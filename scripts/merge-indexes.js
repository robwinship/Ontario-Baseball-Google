import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const PLAYOBA_PATH = path.join(rootDir, "data", "playoba-index.json");
const ONDECK_PATH = path.join(rootDir, "data", "ondeck-index.json");
const OUTPUT_INDEX_PATH = path.join(rootDir, "data", "search-index.json");
const OUTPUT_META_PATH = path.join(rootDir, "data", "search-meta.json");
const PLAYOBA_REPORT_PATH = path.join(rootDir, "data", "playoba-report.json");
const ONDECK_REPORT_PATH = path.join(rootDir, "data", "ondeck-report.json");

function normalizeDocument(doc, source) {
  const normalizedUrl = String(doc.url || "").trim();
  if (!normalizedUrl.startsWith("http")) {
    return null;
  }

  return {
    id: String(doc.id || `${source}:${normalizedUrl}`),
    source,
    accessType: doc.accessType || (source === "playoba" ? "public" : "restricted-indexed"),
    title: String(doc.title || normalizedUrl).trim(),
    url: normalizedUrl,
    section: String(doc.section || "General").trim(),
    snippet: String(doc.snippet || "").trim().slice(0, 320),
    searchText: String(doc.searchText || "").trim().slice(0, 6000),
    headings: Array.isArray(doc.headings) ? doc.headings.slice(0, 16).map((h) => String(h)) : [],
    keywords: Array.isArray(doc.keywords) ? doc.keywords.slice(0, 30).map((k) => String(k)) : [],
    updatedAt: doc.updatedAt || null,
  };
}

async function readJsonArray(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readReport(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasSensitivePattern(text) {
  const patterns = [
    /bearer\s+[a-z0-9._-]+/i,
    /session(id)?=[^\s;]+/i,
    /password\s*[:=]/i,
    /authorization\s*[:=]/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

async function mergeIndexes() {
  const [playobaRaw, ondeckRaw, playobaReport, ondeckReport] = await Promise.all([
    readJsonArray(PLAYOBA_PATH),
    readJsonArray(ONDECK_PATH),
    readReport(PLAYOBA_REPORT_PATH),
    readReport(ONDECK_REPORT_PATH),
  ]);

  const playobaDocs = playobaRaw.map((doc) => normalizeDocument(doc, "playoba")).filter(Boolean);
  const ondeckDocs = ondeckRaw.map((doc) => normalizeDocument(doc, "ondeck")).filter(Boolean);

  const dedupe = new Map();
  for (const doc of [...playobaDocs, ...ondeckDocs]) {
    const key = `${doc.source}:${doc.url}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, doc);
    }
  }

  const merged = [...dedupe.values()];

  const serialized = JSON.stringify(merged);
  if (hasSensitivePattern(serialized)) {
    throw new Error("Sensitive token-like content detected in merged index. Review source data before publishing.");
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    documentCount: merged.length,
    sourceCounts: {
      playoba: playobaDocs.length,
      ondeck: ondeckDocs.length,
    },
    freshness: {
      playoba: playobaReport?.timestamp || null,
      ondeck: ondeckReport?.timestamp || null,
    },
    authCapabilities: {
      ondeckBrowserAuth: false,
    },
  };

  await fs.writeFile(OUTPUT_INDEX_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await fs.writeFile(OUTPUT_META_PATH, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  console.log(`Merged ${merged.length} documents into search-index.json`);
}

mergeIndexes().catch((error) => {
  console.error("merge-indexes failed", error.message);
  process.exitCode = 1;
});
