import dotenv from "dotenv";

dotenv.config();

const DEFAULT_AUTH_API_URL = "https://api.mobilecoach.org/api/auth";

function parseJsonBodyFromCurl(curlText) {
  const inlineBodyMatch = curlText.match(/--data-raw\s+(['\"])([\s\S]*?)\1/i);
  if (!inlineBodyMatch) {
    return null;
  }

  const rawPayload = inlineBodyMatch[2].trim();

  try {
    return JSON.parse(rawPayload);
  } catch {
    try {
      const unescaped = rawPayload.replace(/\\"/g, '"').replace(/\\'/g, "'");
      return JSON.parse(unescaped);
    } catch {
      return null;
    }
  }
}

export function extractMobileCoachPayload(curlText) {
  return parseJsonBodyFromCurl(curlText) || {};
}

function authHeadersFromEnv() {
  const cookie = process.env.ONDECK_COOKIE;
  const bearerToken = process.env.ONDECK_BEARER_TOKEN;

  const headers = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

function hasDirectAuthFromEnv() {
  return Boolean(process.env.ONDECK_COOKIE || process.env.ONDECK_BEARER_TOKEN);
}

function hasMobileCoachAuthFromEnv() {
  return Boolean(process.env.ONDECK_MOBILECOACH_TOKEN && process.env.ONDECK_APP_KEY);
}

async function exchangeMobileCoachAuth(userAgent) {
  const authApiUrl = process.env.ONDECK_AUTH_API_URL || DEFAULT_AUTH_API_URL;
  const mobileCoachToken = process.env.ONDECK_MOBILECOACH_TOKEN;
  const appKey = process.env.ONDECK_APP_KEY;

  const response = await fetch(authApiUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://ondeck.baseballontario.com",
      referer: "https://ondeck.baseballontario.com/",
      "user-agent": userAgent,
    },
    body: JSON.stringify({ token: mobileCoachToken, appKey }),
  });

  if (!response.ok) {
    throw new Error(`Auth exchange failed with status ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") || "";
  let responseJson = {};
  try {
    responseJson = await response.json();
  } catch {
    responseJson = {};
  }

  const possibleToken =
    responseJson.accessToken ||
    responseJson.access_token ||
    responseJson.token ||
    responseJson.jwt ||
    responseJson.id_token ||
    "";

  const headers = {};
  if (setCookie) {
    headers.cookie = setCookie;
  }
  if (possibleToken) {
    headers.authorization = `Bearer ${possibleToken}`;
  }

  if (!headers.cookie && !headers.authorization) {
    throw new Error("Auth exchange succeeded but no usable token/cookie was returned.");
  }

  return headers;
}

export async function buildOndeckAuthHeaders(userAgent) {
  if (hasDirectAuthFromEnv()) {
    return authHeadersFromEnv();
  }

  if (hasMobileCoachAuthFromEnv()) {
    return exchangeMobileCoachAuth(userAgent);
  }

  throw new Error(
    "Missing auth values. Set ONDECK_COOKIE or ONDECK_BEARER_TOKEN, or set ONDECK_MOBILECOACH_TOKEN with ONDECK_APP_KEY in .env"
  );
}
