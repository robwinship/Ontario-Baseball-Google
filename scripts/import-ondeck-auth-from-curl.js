import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { extractMobileCoachPayload } from "./lib/ondeck-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

function extractHeaderValue(curlText, headerName) {
  const regex = new RegExp(`(?:-H|--header)\\s+['\"]${headerName}\\s*:\\s*([^'\"]+)['\"]`, "i");
  const match = curlText.match(regex);
  return match ? match[1].trim() : "";
}

function extractBearerToken(authorizationValue) {
  const match = authorizationValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function extractCurlUrl(curlText) {
  const match = curlText.match(/^\s*curl\s+['\"]([^'\"]+)['\"]/im);
  return match ? match[1] : "";
}

function upsertEnvLine(envText, key, value) {
  const lines = envText.split(/\r?\n/);
  const next = [];
  let replaced = false;

  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      next.push(`${key}=${value}`);
      replaced = true;
    } else {
      next.push(line);
    }
  }

  if (!replaced) {
    next.push(`${key}=${value}`);
  }

  return `${next.join("\n").replace(/\n+$/g, "")}\n`;
}

async function ensureEnvExists() {
  try {
    await fs.access(envPath);
  } catch {
    throw new Error(".env file not found. Create it first by copying .env.example to .env");
  }
}

async function readCurlInput() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  const rl = readline.createInterface({ input, output });
  output.write("Paste full DevTools 'Copy as cURL' content, then press Enter twice:\n");

  const parts = [];
  while (true) {
    const line = await rl.question("");
    if (!line.trim()) {
      break;
    }
    parts.push(line);
  }
  rl.close();
  return parts.join("\n").trim();
}

async function run() {
  await ensureEnvExists();

  const curlText = await readCurlInput();
  if (!curlText.toLowerCase().includes("curl")) {
    throw new Error("Input does not look like cURL content.");
  }

  const cookieValue = extractHeaderValue(curlText, "cookie");
  const authHeaderValue = extractHeaderValue(curlText, "authorization");
  const bearerToken = extractBearerToken(authHeaderValue);
  const payload = extractMobileCoachPayload(curlText);
  const mobileCoachToken = typeof payload.token === "string" ? payload.token.trim() : "";
  const appKey = typeof payload.appKey === "string" ? payload.appKey.trim() : "";
  const curlUrl = extractCurlUrl(curlText);

  if (!cookieValue && !bearerToken && !mobileCoachToken) {
    throw new Error("No Cookie, Bearer Authorization, or token payload found in cURL text.");
  }

  let envText = await fs.readFile(envPath, "utf8");

  if (cookieValue) {
    envText = upsertEnvLine(envText, "ONDECK_COOKIE", cookieValue);
  }

  if (bearerToken) {
    envText = upsertEnvLine(envText, "ONDECK_BEARER_TOKEN", bearerToken);
  }

  if (mobileCoachToken) {
    envText = upsertEnvLine(envText, "ONDECK_MOBILECOACH_TOKEN", mobileCoachToken);
  }

  if (appKey) {
    envText = upsertEnvLine(envText, "ONDECK_APP_KEY", appKey);
  }

  if (curlUrl && curlUrl.toLowerCase().includes("api.mobilecoach.org")) {
    envText = upsertEnvLine(envText, "ONDECK_AUTH_API_URL", curlUrl);
  }

  await fs.writeFile(envPath, envText, "utf8");

  const updated = [
    cookieValue ? "ONDECK_COOKIE" : null,
    bearerToken ? "ONDECK_BEARER_TOKEN" : null,
    mobileCoachToken ? "ONDECK_MOBILECOACH_TOKEN" : null,
    appKey ? "ONDECK_APP_KEY" : null,
    curlUrl && curlUrl.toLowerCase().includes("api.mobilecoach.org") ? "ONDECK_AUTH_API_URL" : null,
  ]
    .filter(Boolean)
    .join(", ");

  console.log(`Updated local .env keys: ${updated}`);
  console.log("Next step: run npm run auth:ondeck");
}

run().catch((error) => {
  console.error(`Import failed: ${error.message}`);
  process.exitCode = 1;
});
