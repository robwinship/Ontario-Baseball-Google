import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import { buildOndeckAuthHeaders } from "./lib/ondeck-auth.js";

dotenv.config();

if (process.env.CI === "true") {
  console.error("crawl:ondeck must run locally only. Refusing to run in CI.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const BASE_URL = process.env.ONDECK_BASE_URL || "https://ondeck.baseballontario.com";
const OUTPUT_PATH = path.join(rootDir, "data", "ondeck-index.json");
const REPORT_PATH = path.join(rootDir, "data", "ondeck-report.json");
const MAX_PAGES = Number(process.env.ONDECK_MAX_PAGES || 200);
const MAX_DEPTH = Number(process.env.ONDECK_MAX_DEPTH || 3);
const USER_AGENT = "OBA-SearchBot/0.1 (+local authenticated index generator)";

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, BASE_URL);
    if (url.origin !== new URL(BASE_URL).origin) {
      return null;
    }
    url.hash = "";
    const blockedExtensions = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".svg", ".webp"];
    if (blockedExtensions.some((ext) => url.pathname.toLowerCase().endsWith(ext))) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function inferSection(url) {
  const { pathname } = new URL(url);
  const first = pathname.split("/").filter(Boolean)[0];
  return first ? first.replace(/[-_]/g, " ") : "Home";
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function scrubSensitive(value) {
  return value
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}/g, "[redacted-token]")
    .replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1[redacted]")
    .replace(/session(id)?=[^\s;]+/gi, "session=[redacted]");
}

function keywordsFromText(text) {
  const stopWords = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "into", "have", "will", "are"]);
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const freq = new Map();
  for (const token of tokens) {
    if (token.length < 3 || stopWords.has(token)) {
      continue;
    }
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([token]) => token);
}

async function crawlOndeck() {
  const headers = {
    "user-agent": USER_AGENT,
    ...(await buildOndeckAuthHeaders(USER_AGENT)),
  };
  const queue = [{ url: BASE_URL, depth: 0 }];
  const visited = new Set();
  const docs = [];
  const report = { scanned: 0, indexed: 0, skipped: 0, errors: 0, timestamp: new Date().toISOString() };

  while (queue.length && docs.length < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (!url || visited.has(url)) {
      continue;
    }
    visited.add(url);

    if (depth > MAX_DEPTH) {
      report.skipped += 1;
      continue;
    }

    try {
      const response = await fetch(url, { headers, redirect: "follow" });
      report.scanned += 1;
      if (!response.ok) {
        report.skipped += 1;
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        report.skipped += 1;
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = cleanText($("title").first().text()) || cleanText($("h1").first().text()) || url;
      const headingText = $("h1, h2, h3")
        .map((_, el) => cleanText($(el).text()))
        .get()
        .filter(Boolean)
        .slice(0, 12);

      const bodyTextRaw = cleanText(
        $("main, article, .content, .entry-content, body")
          .first()
          .text()
      );
      const bodyText = scrubSensitive(bodyTextRaw);
      const snippet = bodyText.slice(0, 260);
      const section = inferSection(url);
      const keywords = keywordsFromText(`${title} ${headingText.join(" ")} ${snippet}`);

      docs.push({
        id: `ondeck:${url}`,
        source: "ondeck",
        accessType: "restricted-indexed",
        title,
        url,
        section,
        snippet,
        headings: headingText,
        keywords,
        updatedAt: new Date().toISOString(),
      });
      report.indexed += 1;

      if (depth < MAX_DEPTH) {
        $("a[href]").each((_, anchor) => {
          const href = $(anchor).attr("href");
          const normalized = normalizeUrl(href || "");
          if (normalized && !visited.has(normalized)) {
            queue.push({ url: normalized, depth: depth + 1 });
          }
        });
      }
    } catch {
      report.errors += 1;
    }
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(docs, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Indexed ${docs.length} ondeck documents using local credentials.`);
}

crawlOndeck().catch((error) => {
  console.error("crawl:ondeck failed", error.message);
  process.exitCode = 1;
});
