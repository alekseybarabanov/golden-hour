// Shared paths and built-in theme for study-cards PNG output.
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE, userDir, readText } from "./cli.mjs";
import { loadProfile } from "./profile.mjs";

/** Default theme if user has no profile or no theme field. */
export const CARD_THEME = "dark";

/**
 * Resolve the card theme for a user.
 * Reads `profile.md → theme` (light | dark), markdown or plain YAML.
 */
export function resolveCardTheme(userKey) {
  if (!userKey) return CARD_THEME;
  const dir = userDir(userKey);
  const { profile } = loadProfile(dir, (p) => readText(p));
  if (profile?.theme === "light") return "light";
  return CARD_THEME;
}

export const STUDY_CARDS_DIR = path.join(WORKSPACE, "skills", "study-cards");
export const RENDER_ORCHESTRATOR = path.join(
  WORKSPACE,
  "skills",
  "study-plan-cards",
  "scripts",
  "render.js"
);
export const RENDER_TABLE_JS = path.join(STUDY_CARDS_DIR, "render-table.js");
