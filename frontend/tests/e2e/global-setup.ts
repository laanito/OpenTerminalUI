import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

export default async function globalSetup(config: FullConfig) {
  const firstProjectBaseUrl = config.projects.find((project) => project.name === "chromium")?.use?.baseURL;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, "..", "..", "..");
  const storageStatePath =
    process.env.PLAYWRIGHT_AUTH_STATE_PATH || path.join(repoRoot, "frontend", "test-results", ".auth", "user.json");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: nowSeconds + 3_600,
  });
  const refreshToken = makeJwt({ exp: nowSeconds + 7_200 });
  const origin = new URL(typeof firstProjectBaseUrl === "string" ? firstProjectBaseUrl : "http://127.0.0.1:4173").origin;

  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await fs.writeFile(
    storageStatePath,
    JSON.stringify({
      cookies: [],
      origins: [{
        origin,
        localStorage: [
          { name: "ot-access-token", value: accessToken },
          { name: "ot-refresh-token", value: refreshToken },
        ],
      }],
    }),
    "utf8",
  );
}
