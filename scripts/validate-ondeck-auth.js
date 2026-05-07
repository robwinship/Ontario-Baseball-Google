import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.ONDECK_BASE_URL || "https://ondeck.baseballontario.com";

function getAuthHeaders() {
  const cookie = process.env.ONDECK_COOKIE;
  const token = process.env.ONDECK_BEARER_TOKEN;

  if (!cookie && !token) {
    throw new Error("Missing auth values. Set ONDECK_COOKIE or ONDECK_BEARER_TOKEN in .env");
  }

  const headers = {
    "user-agent": "OBA-SearchBot/0.1 (+local auth validator)",
  };

  if (cookie) {
    headers.cookie = cookie;
  }

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function looksLikeLoginRedirect(url) {
  if (!url) {
    return false;
  }
  const value = url.toLowerCase();
  return value.includes("login") || value.includes("signin") || value.includes("auth");
}

async function validate() {
  const headers = getAuthHeaders();
  const response = await fetch(BASE_URL, {
    headers,
    redirect: "follow",
  });

  const finalUrl = response.url;
  const contentType = response.headers.get("content-type") || "";
  const bodyPreview = (await response.text()).slice(0, 1200).toLowerCase();

  const authLikelyFailed =
    response.status === 401 ||
    response.status === 403 ||
    looksLikeLoginRedirect(finalUrl) ||
    bodyPreview.includes("sign in") ||
    bodyPreview.includes("log in") ||
    bodyPreview.includes("password");

  console.log(`Status: ${response.status}`);
  console.log(`Final URL: ${finalUrl}`);
  console.log(`Content-Type: ${contentType}`);

  if (authLikelyFailed) {
    console.error("Auth check failed or redirected to login. Refresh your cookie/token and try again.");
    process.exitCode = 1;
    return;
  }

  console.log("Auth appears valid. You can run: npm run crawl:ondeck");
}

validate().catch((error) => {
  console.error(`Validation error: ${error.message}`);
  process.exitCode = 1;
});
