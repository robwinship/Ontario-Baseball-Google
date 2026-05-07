import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const seedPath = path.join(rootDir, "data", "ondeck-seed-urls.txt");

function normalizeOndeckUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (url.hostname !== "ondeck.baseballontario.com") {
    throw new Error("URL must be on ondeck.baseballontario.com.");
  }

  url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function extractExistingUrls(fileContent) {
  const raw = fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const normalized = [];
  for (const line of raw) {
    try {
      normalized.push(normalizeOndeckUrl(line));
    } catch {
      // Keep malformed lines out of dedupe set.
    }
  }

  return normalized;
}

async function run() {
  const rawArg = process.argv.slice(2).join(" ").trim();
  if (!rawArg) {
    throw new Error("Usage: npm run seed:add-ondeck -- <ondeck-url>");
  }

  const normalized = normalizeOndeckUrl(rawArg);

  let fileContent;
  try {
    fileContent = await fs.readFile(seedPath, "utf8");
  } catch {
    fileContent = "# Optional manual seed URLs for ondeck SPA routes.\n";
  }

  const existing = new Set(extractExistingUrls(fileContent));
  if (existing.has(normalized)) {
    console.log("Seed URL already exists. No changes made.");
    console.log(normalized);
    return;
  }

  const next = `${fileContent.replace(/\s*$/g, "")}\n${normalized}\n`;
  await fs.writeFile(seedPath, next, "utf8");
  console.log("Added seed URL:");
  console.log(normalized);
}

run().catch((error) => {
  console.error(`add-ondeck-seed-url failed: ${error.message}`);
  process.exitCode = 1;
});
