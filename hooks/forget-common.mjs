// Shared helpers for claude-forget (dependency-free Node, cross-platform).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

// One flag file per armed session lives here, so multiple armed sessions coexist.
export const FLAG_DIR = path.join(CLAUDE_DIR, "forget-pending");

// All currently-armed wipes: [{ path, data }], one per session.
export function listPendingFlags() {
  const out = [];
  for (const n of listDir(FLAG_DIR)) {
    if (!n.endsWith(".json")) continue;
    const p = path.join(FLAG_DIR, n);
    const d = readJSON(p);
    if (d) out.push({ path: p, data: d });
  }
  return out;
}

export function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

export function listDir(p) {
  try { return fs.readdirSync(p); } catch { return []; }
}

export function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

export function isDir(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch { return false; }
}

export function countFiles(dir) {
  if (!isDir(dir)) return 0;
  let n = 0;
  for (const e of listDir(dir)) {
    const p = path.join(dir, e);
    if (isDir(p)) n += countFiles(p); else n++;
  }
  return n;
}

// All session ids belonging to a project: transcript basenames under projectDir,
// unioned with history.jsonl lines whose project === cwd.
export function projectSessionIds(projectDir, historyPath, cwd) {
  const ids = new Set();
  if (projectDir && isDir(projectDir)) {
    for (const n of listDir(projectDir)) {
      if (n.endsWith(".jsonl")) ids.add(n.slice(0, -".jsonl".length));
    }
  }
  if (historyPath && fs.existsSync(historyPath)) {
    try {
      for (const ln of fs.readFileSync(historyPath, "utf8").split("\n")) {
        const s = ln.trim();
        if (!s) continue;
        let d; try { d = JSON.parse(s); } catch { continue; }
        if (d.project === cwd && d.sessionId) ids.add(d.sessionId);
      }
    } catch { /* ignore */ }
  }
  return ids;
}

export function perSessionPaths(claudeDir, sid) {
  return [
    path.join(claudeDir, "session-env", sid),
    path.join(claudeDir, "file-history", sid),
    path.join(claudeDir, "tasks", sid),
    path.join(claudeDir, "security", `security_warnings_state_${sid}.json`),
    path.join(claudeDir, "security", `security_warnings_state_${sid}.lock`),
  ];
}

export function countHistoryLines(historyPath, cwd) {
  let n = 0;
  if (historyPath && fs.existsSync(historyPath)) {
    try {
      for (const ln of fs.readFileSync(historyPath, "utf8").split("\n")) {
        const s = ln.trim();
        if (!s) continue;
        try { if (JSON.parse(s).project === cwd) n++; } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  return n;
}

export function countSecurityLogLines(logPath, cwd) {
  let n = 0;
  if (logPath && fs.existsSync(logPath)) {
    try {
      for (const ln of fs.readFileSync(logPath, "utf8").split("\n")) {
        if (ln.includes(cwd)) n++;
      }
    } catch { /* ignore */ }
  }
  return n;
}

// ~/.claude.json backup files that still contain projects[cwd].
export function backupsWithProject(backupsDir, cwd) {
  const hits = [];
  if (!isDir(backupsDir)) return hits;
  for (const n of listDir(backupsDir)) {
    if (!n.includes(".claude.json.backup")) continue;
    const p = path.join(backupsDir, n);
    const d = readJSON(p);
    if (d && d.projects && typeof d.projects === "object" && Object.prototype.hasOwnProperty.call(d.projects, cwd)) {
      hits.push(p);
    }
  }
  return hits;
}

// The live transcript: newest .jsonl under the encoded project dir, falling back
// to the globally newest transcript (the one being actively written).
export function newestTranscript(projectsDir, cwd) {
  const candidates = [];
  const enc = cwd.split(path.sep).join("-"); // best-effort encoding; fallback covers misses
  const encDir = path.join(projectsDir, enc);
  for (const n of listDir(encDir)) {
    if (n.endsWith(".jsonl")) candidates.push(path.join(encDir, n));
  }
  if (candidates.length === 0) {
    for (const sub of listDir(projectsDir)) {
      const d = path.join(projectsDir, sub);
      if (!isDir(d)) continue;
      for (const n of listDir(d)) {
        if (n.endsWith(".jsonl")) candidates.push(path.join(d, n));
      }
    }
  }
  let best = null, bestM = -1;
  for (const c of candidates) {
    try { const m = fs.statSync(c).mtimeMs; if (m > bestM) { bestM = m; best = c; } } catch { /* ignore */ }
  }
  return best;
}
