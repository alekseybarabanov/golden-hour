// Per-user timer storage: prefer users/<key>/timer/, auto-migrate from pomodoro/.

import fs from "node:fs";
import path from "node:path";

export function resolveTimerDir(userDirPath, { autoMigrate = true } = {}) {
  const timerDir = path.join(userDirPath, "timer");
  const legacyDir = path.join(userDirPath, "pomodoro");
  if (fs.existsSync(timerDir)) return timerDir;
  if (fs.existsSync(legacyDir)) {
    if (autoMigrate) {
      fs.cpSync(legacyDir, timerDir, { recursive: true });
      return timerDir;
    }
    return legacyDir;
  }
  return timerDir;
}
