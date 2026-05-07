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
const SEED_URLS_PATH = path.join(rootDir, "data", "ondeck-seed-urls.txt");
const MAX_PAGES = Number(process.env.ONDECK_MAX_PAGES || 200);
const MAX_DEPTH = Number(process.env.ONDECK_MAX_DEPTH || 3);
const ENABLE_API_DISCOVERY = process.env.ONDECK_ENABLE_API_DISCOVERY !== "false";
const ENABLE_RENDERED_EXTRACTION = process.env.ONDECK_ENABLE_RENDERED_EXTRACTION !== "false";
const RENDERED_TIMEOUT_MS = Number(process.env.ONDECK_RENDERED_TIMEOUT_MS || 30000);
const MOBILECOACH_API_BASE = process.env.ONDECK_MOBILECOACH_API_BASE || "https://api.mobilecoach.org/api";
const MOBILECOACH_ENDPOINTS = [
  "groups",
  "pages",
  "questions",
  "profile-sections",
  "groupTypes",
  "countries",
  "open",
  "status",
  "certs?typeCode=CERTIFICATION",
];
const USER_AGENT = "OBA-SearchBot/0.1 (+local authenticated index generator)";

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, BASE_URL);
    if (url.origin !== new URL(BASE_URL).origin) {
      return null;
    }
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
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

function titleFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || parts[parts.length - 2] || "ondeck";
    return slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "Ondeck Document";
  }
}

function keywordsFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname
      .split(/[^a-z0-9]+/)
      .filter((token) => token && token.length > 2)
      .slice(0, 25);
  } catch {
    return [];
  }
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

function resolveApiUrl(endpoint) {
  const base = MOBILECOACH_API_BASE.replace(/\/+$/, "");
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${base}/${endpoint}${separator}locale=en_US`;
}

function extractStrings(value, out = []) {
  if (typeof value === "string") {
    const cleaned = cleanText(scrubSensitive(value));
    if (cleaned) {
      out.push(cleaned);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractStrings(item, out);
      if (out.length >= 120) {
        break;
      }
    }
    return out;
  }

  if (value && typeof value === "object") {
    for (const objectValue of Object.values(value)) {
      extractStrings(objectValue, out);
      if (out.length >= 120) {
        break;
      }
    }
  }

  return out;
}

function pickApiTitle(record, endpoint, index) {
  const preferredKeys = ["title", "name", "label", "question", "heading", "description"];
  for (const key of preferredKeys) {
    if (record && typeof record[key] === "string" && cleanText(record[key])) {
      return cleanText(record[key]);
    }
  }

  const firstString = extractStrings(record)[0];
  if (firstString) {
    return firstString.slice(0, 120);
  }

  return `${endpoint} item ${index + 1}`;
}

function endpointSection(endpoint) {
  return endpoint.split("?")[0].replace(/[-_]/g, " ");
}

function endpointToRoute(endpoint, record) {
  const path = endpoint.split("?")[0];
  const id =
    (record && (record.id ?? record.pageId ?? record.groupId ?? record.questionId ?? record.slug)) ||
    null;
  return id ? `${path}/${id}` : path;
}

async function createRenderedExtractor(headers) {
  if (!ENABLE_RENDERED_EXTRACTION) {
    return null;
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: headers["user-agent"] || USER_AGENT,
      extraHTTPHeaders: {
        ...(headers.cookie ? { cookie: headers.cookie } : {}),
        ...(headers.authorization ? { authorization: headers.authorization } : {}),
      },
    });
    const page = await context.newPage();

    const close = async () => {
      await context.close();
      await browser.close();
    };

    const extract = async (url) => {
      await page.goto(url, { waitUntil: "networkidle", timeout: RENDERED_TIMEOUT_MS });
      await page.waitForTimeout(900);

      return page.evaluate(() => {
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const headingValues = Array.from(document.querySelectorAll("h1, h2, h3"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 20);
        return { bodyText, headingValues };
      });
    };

    return { extract, close };
  } catch {
    console.warn("Rendered extraction unavailable. Install Playwright dependencies to enable SPA text indexing.");
    return null;
  }
}

async function loadSeedUrls() {
  const seedSet = new Set();

  const envSeeds = process.env.ONDECK_SEED_URLS || "";
  envSeeds
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => seedSet.add(value));

  try {
    const fileContent = await fs.readFile(SEED_URLS_PATH, "utf8");
    fileContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => seedSet.add(line));
  } catch {
    // Seed file is optional.
  }

  return [...seedSet]
    .map((value) => normalizeUrl(value))
    .filter(Boolean);
}

async function enrichFromApi(headers, docs, report) {
  const appKey = process.env.ONDECK_APP_KEY;
  const authHeaders = {
    accept: "application/json",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    "user-agent": USER_AGENT,
    ...headers,
  };

  if (appKey) {
    authHeaders.appkey = appKey;
    authHeaders["x-app-key"] = appKey;
  }

  const existingIds = new Set(docs.map((doc) => doc.id));

  for (const endpoint of MOBILECOACH_ENDPOINTS) {
    const url = resolveApiUrl(endpoint);
    try {
      const response = await fetch(url, { headers: authHeaders, redirect: "follow" });
      report.apiScanned += 1;

      if (!response.ok) {
        report.apiSkipped += 1;
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        report.apiSkipped += 1;
        continue;
      }

      const payload = await response.json();
      const records = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : payload && typeof payload === "object"
            ? [payload]
            : [];

      records.slice(0, 300).forEach((record, index) => {
        const title = pickApiTitle(record, endpoint, index);
        const snippet = cleanText(extractStrings(record).join(" ")).slice(0, 260);
        const route = endpointToRoute(endpoint, record);
        const docUrl = `${BASE_URL}/#/${route}`;
        const id = `ondeck-api:${endpoint}:${record?.id ?? record?.pageId ?? record?.groupId ?? index}`;

        if (existingIds.has(id)) {
          return;
        }
        existingIds.add(id);

        docs.push({
          id,
          source: "ondeck",
          accessType: "restricted-indexed",
          title,
          url: docUrl,
          section: endpointSection(endpoint),
          snippet,
          searchText: cleanText(`${title} ${snippet} ${docUrl}`),
          headings: [],
          keywords: keywordsFromText(`${title} ${snippet}`),
          updatedAt: new Date().toISOString(),
        });
        report.apiIndexed += 1;
      });
    } catch {
      report.apiErrors += 1;
    }
  }
}

async function crawlOndeck() {
  const headers = {
    "user-agent": USER_AGENT,
    ...(await buildOndeckAuthHeaders(USER_AGENT)),
  };
  const seed = normalizeUrl(BASE_URL);
  const queue = [{ url: seed || BASE_URL, depth: 0 }];
  const extraSeeds = await loadSeedUrls();
  for (const extra of extraSeeds) {
    queue.push({ url: extra, depth: 0 });
  }
  const visited = new Set();
  const docs = [];
  const rendered = await createRenderedExtractor(headers);
  const report = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    apiScanned: 0,
    apiIndexed: 0,
    apiSkipped: 0,
    apiErrors: 0,
    renderedAttempts: 0,
    renderedSuccess: 0,
    renderedErrors: 0,
    seedUrls: extraSeeds.length,
    timestamp: new Date().toISOString(),
  };

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

      const rawTitle = cleanText($("title").first().text()) || cleanText($("h1").first().text()) || url;
      const title = rawTitle === "Baseball Ontario - OnDeck" ? titleFromUrl(url) : rawTitle;
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
      let bodyText = scrubSensitive(bodyTextRaw);
      let headings = headingText;

      const shouldUseRendered =
        rendered &&
        (bodyText.length < 80 || title === "Baseball Ontario - OnDeck" || headingText.length === 0) &&
        (extraSeeds.includes(url) || url.includes("/page/"));

      if (shouldUseRendered) {
        report.renderedAttempts += 1;
        try {
          const renderedData = await rendered.extract(url);
          if (renderedData?.bodyText) {
            bodyText = scrubSensitive(cleanText(renderedData.bodyText));
          }
          if (Array.isArray(renderedData?.headingValues) && renderedData.headingValues.length > 0) {
            headings = renderedData.headingValues.map((value) => cleanText(value)).filter(Boolean).slice(0, 20);
          }
          report.renderedSuccess += 1;
        } catch {
          report.renderedErrors += 1;
        }
      }

      const snippet = bodyText.slice(0, 260);
      const section = inferSection(url);
      const keywords = [
        ...new Set([...keywordsFromText(`${title} ${headings.join(" ")} ${bodyText}`), ...keywordsFromUrl(url)]),
      ].slice(0, 30);

      docs.push({
        id: `ondeck:${url}`,
        source: "ondeck",
        accessType: "restricted-indexed",
        title,
        url,
        section,
        snippet,
        searchText: cleanText(`${title} ${headings.join(" ")} ${bodyText} ${url}`).slice(0, 30000),
        headings,
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

  if (ENABLE_API_DISCOVERY) {
    await enrichFromApi(headers, docs, report);
  }

  if (rendered) {
    await rendered.close();
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(docs, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Indexed ${docs.length} ondeck documents using local credentials (${report.apiIndexed} via API discovery).`);
}

crawlOndeck().catch((error) => {
  console.error("crawl:ondeck failed", error.message);
  process.exitCode = 1;
});
