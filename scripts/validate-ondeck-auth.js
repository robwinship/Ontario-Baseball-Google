import dotenv from "dotenv";
import { buildOndeckAuthHeaders } from "./lib/ondeck-auth.js";

dotenv.config();

const BASE_URL = process.env.ONDECK_BASE_URL || "https://ondeck.baseballontario.com";
const USER_AGENT = "OBA-SearchBot/0.1 (+local auth validator)";

function looksLikeLoginRedirect(url) {
  if (!url) {
    return false;
  }
  const value = url.toLowerCase();
  return value.includes("login") || value.includes("signin") || value.includes("auth");
}

async function validate() {
  const headers = {
    "user-agent": USER_AGENT,
    ...(await buildOndeckAuthHeaders(USER_AGENT)),
  };
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
