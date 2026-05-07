import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const BASE_URL = "https://playoba.ca";
const OUTPUT_PATH = path.join(rootDir, "data", "playoba-index.json");
const REPORT_PATH = path.join(rootDir, "data", "playoba-report.json");
const MAX_PAGES = Number(process.env.PLAYOBA_MAX_PAGES || 250);
const MAX_DEPTH = Number(process.env.PLAYOBA_MAX_DEPTH || 3);
const USER_AGENT = "OBA-SearchBot/0.1 (+local index generator)";

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, BASE_URL);
    if (url.origin !== BASE_URL) {
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

async function loadRobotsRules() {
  try {
    const response = await fetch(`${BASE_URL}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
    });
    if (!response.ok) {
      return [];
    }
    const body = await response.text();
    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith("disallow:"))
      .map((line) => line.split(":")[1]?.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isDisallowed(url, disallowRules) {
  const pathname = new URL(url).pathname;
  return disallowRules.some((rule) => {
    if (rule === "/") {
      return true;
    }
    return pathname.startsWith(rule);
  });
}

async function crawlPlayoba() {
  const disallowRules = await loadRobotsRules();
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

    if (depth > MAX_DEPTH || isDisallowed(url, disallowRules)) {
      report.skipped += 1;
      continue;
    }

    try {
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
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

      const bodyText = cleanText(
        $("main, article, .content, .entry-content, body")
          .first()
          .text()
      );

      const snippet = bodyText.slice(0, 260);
      const section = inferSection(url);
      const keywords = keywordsFromText(`${title} ${headingText.join(" ")} ${snippet}`);

      docs.push({
        id: `playoba:${url}`,
        source: "playoba",
        accessType: "public",
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
  console.log(`Indexed ${docs.length} playoba documents.`);
}

crawlPlayoba().catch((error) => {
  console.error("crawl:playoba failed", error);
  process.exitCode = 1;
});
