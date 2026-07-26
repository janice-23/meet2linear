import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(serverRoot, "..");

// .env lives at the repo root; also allow server/.env
for (const candidate of [path.join(repoRoot, ".env"), path.join(serverRoot, ".env")]) {
  if (existsSync(candidate)) loadEnvFile(candidate);
}

export const env = {
  port: Number(process.env.PORT ?? 7337),
  geminiApiKey: process.env.GEMINI_API_KEY,
  linearApiKey: process.env.LINEAR_API_KEY,
  linearTeamId: process.env.LINEAR_TEAM_ID,
  linearLabelId: process.env.LINEAR_LABEL_ID,
  dataDir: path.join(serverRoot, "data"),
};

export function requireEnv(name: "geminiApiKey" | "linearApiKey" | "linearTeamId"): string {
  const value = env[name];
  if (!value) {
    const envVar = { geminiApiKey: "GEMINI_API_KEY", linearApiKey: "LINEAR_API_KEY", linearTeamId: "LINEAR_TEAM_ID" }[name];
    throw new Error(`Missing ${envVar} — set it in .env at the repo root (see .env.example)`);
  }
  return value;
}
