#!/usr/bin/env node
// forget-cleanup.mjs — hook entrypoint for SessionStart and SessionEnd.
// Iterates EVERY armed flag (one per session) and performs the ones that are safe
// for this event. Reads the hook payload on stdin.
//   scope=session → delete that session's transcript + project memory
//   scope=project → delete every Claude-realm reference to the project
// Set FORGET_DRY_RUN=1 to print planned actions instead of performing them.
import fs from "node:fs";
import path from "node:path";
import * as fc from "./forget-common.mjs";

const CLAUDE_DIR = fc.CLAUDE_DIR;
const DRY = process.env.FORGET_DRY_RUN === "1";

const CLAUDE_JSON = fc.CLAUDE_JSON;
const HISTORY = path.join(CLAUDE_DIR, "history.jsonl");
const SECLOG = path.join(CLAUDE_DIR, "security", "log.txt");
const BACKUPS = path.join(CLAUDE_DIR, "backups");
const SESSIONS = path.join(CLAUDE_DIR, "sessions");

const log = (s) => process.stdout.write(s + "\n");
const exit = () => process.exit(0);

// Fast exit: nothing armed.
const flags = fc.listPendingFlags();
if (flags.length === 0) exit();

let payload = "";
try { payload = fs.readFileSync(0, "utf8"); } catch { payload = ""; }
let ev = {};
if (payload.trim()) { try { ev = JSON.parse(payload); } catch { ev = {}; } }

const event = ev.hook_event_name || "";
const source = ev.source || "";
const evCwd = ev.cwd || process.cwd();
const evTx = ev.transcript_path || "";
const evSid = ev.session_id || "";

const rp = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

function rm(p, label) {
  if (!p) return;
  if (DRY) {
    const kind = fc.isDir(p) ? "dir " : "file";
    log(`[dry-run] ${fc.exists(p) ? "DELETE" : "skip  "} ${kind} ${label}: ${p}`);
    return;
  }
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function atomicWrite(p, data) {
  const dir = path.dirname(p) || ".";
  const tmp = path.join(dir, `.forget-tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

function scrubJsonl(p, dropPred, label) {
  if (!fs.existsSync(p)) return;
  try {
    const kept = [];
    let dropped = 0;
    for (const ln of fs.readFileSync(p, "utf8").split("\n")) {
      const s = ln.trim();
      if (!s) continue;
      let obj;
      try { obj = JSON.parse(s); } catch { kept.push(ln); continue; }
      if (dropPred(obj)) { dropped++; continue; }
      kept.push(ln);
    }
    if (DRY) { log(`[dry-run] scrub ${label}: drop ${dropped} line(s)`); return; }
    atomicWrite(p, kept.length ? kept.join("\n") + "\n" : "");
  } catch { /* ignore */ }
}

function scrubTextLines(p, contains, label) {
  if (!fs.existsSync(p)) return;
  try {
    const kept = [];
    let dropped = 0;
    for (const ln of fs.readFileSync(p, "utf8").split("\n")) {
      if (ln.includes(contains)) { dropped++; continue; }
      kept.push(ln);
    }
    if (DRY) { log(`[dry-run] scrub ${label}: drop ${dropped} line(s)`); return; }
    atomicWrite(p, kept.join("\n"));
  } catch { /* ignore */ }
}

function removeProjectFromJson(p, cwd, label, backup = false) {
  if (!fs.existsSync(p)) return;
  const d = fc.readJSON(p);
  if (!d || !d.projects || typeof d.projects !== "object" ||
      !Object.prototype.hasOwnProperty.call(d.projects, cwd)) return;
  if (DRY) { log(`[dry-run] ${label}: remove projects["${cwd}"]${backup ? " (after backup)" : ""}`); return; }
  try {
    if (backup) {
      try { fs.copyFileSync(p, path.join(BACKUPS, `.claude.json.prenuke.${Date.now()}`)); } catch { /* ignore */ }
    }
    delete d.projects[cwd];
    atomicWrite(p, JSON.stringify(d, null, 2));
  } catch { /* ignore */ }
}

function dropFlag(flagPath) {
  if (DRY) { log(`[dry-run] would remove flag: ${flagPath}`); return; }
  try { fs.rmSync(flagPath, { force: true }); } catch { /* ignore */ }
}
function updateFlag(flagPath, extra) {
  if (DRY) { log(`[dry-run] keep flag ${path.basename(flagPath)}, set: ${JSON.stringify(extra)}`); return; }
  try { const d = fc.readJSON(flagPath) || {}; Object.assign(d, extra); atomicWrite(flagPath, JSON.stringify(d)); } catch { /* ignore */ }
}

// Process one armed flag against the current hook event.
function processFlag(flagPath, flag) {
  const scope = flag.scope || "session";
  const fTx = flag.transcript || "";
  const fSid = flag.session_id || "";
  const fCwd = flag.cwd || "";

  // Only act in the project this flag was armed in.
  if (fCwd && evCwd && rp(fCwd) !== rp(evCwd)) return;

  const sameAsActive = !!evTx && rp(evTx) === rp(fTx);

  // ---- SESSION SCOPE ----
  if (scope === "session") {
    const fMem = flag.memory_dir || "";
    let finalize = true;
    if (event === "SessionStart") {
      if (source === "compact") return;          // same session continues
      if (sameAsActive) {
        if (source === "resume") dropFlag(flagPath); // resumed armed session → cancel
        return;
      }
      finalize = true;                            // startup / clear / resume-other → armed is closed
    } else if (event === "SessionEnd") {
      if (evSid && fSid && evSid !== fSid) return;
      if (!evSid && evTx && !sameAsActive) return;
      finalize = false;                           // delete now, keep flag for the ghost sweep
    } else {
      return;
    }

    const sid = fSid || (fTx ? path.basename(fTx).replace(/\.jsonl$/, "") : "");
    rm(fTx, "transcript");
    rm(fTx + ".meta", "transcript meta");
    if (fTx.endsWith(".jsonl")) rm(fTx.slice(0, -".jsonl".length), "session subdir");
    if (sid) {
      rm(path.join(CLAUDE_DIR, "session-env", sid), "session-env");
      scrubJsonl(HISTORY, (o) => o.sessionId === sid, "history.jsonl");
    }
    rm(fMem, "project memory");
    if (finalize) dropFlag(flagPath); else updateFlag(flagPath, { ghost_sweep: true });
    return;
  }

  // ---- PROJECT SCOPE ----
  const projectDir = flag.project_dir || "";
  const cwd = fCwd;
  const heavyDone = !!flag.heavy_done;

  let preserveSid = null;
  let preserveTx = null;
  let finalize = true;

  if (event === "SessionEnd") {
    if (!((fSid && evSid && evSid === fSid) ||
          (evTx && rp(evTx) === rp(fTx)) ||
          (!evSid && !evTx))) return;             // a different session ended
    finalize = false;                             // nuke now, keep flag for the ghost sweep
  } else if (event === "SessionStart") {
    if (source === "resume" && sameAsActive) { dropFlag(flagPath); return; } // resumed armed → cancel
    if (source === "startup" || source === "resume") {
      preserveSid = evSid; preserveTx = evTx;     // keep the new session
      finalize = true;
    } else {
      return;                                     // /clear and compact do NOT complete a project nuke
    }
  } else {
    return;
  }

  const doGlobals = !heavyDone;

  const ids = fc.projectSessionIds(projectDir, HISTORY, cwd);
  if (preserveSid) ids.delete(preserveSid);

  // 1) project session/memory directory
  if (preserveTx && projectDir && rp(path.dirname(preserveTx)) === rp(projectDir)) {
    const keepBase = path.basename(preserveTx);
    const keepSub = keepBase.endsWith(".jsonl") ? keepBase.slice(0, -".jsonl".length) : null;
    for (const n of fc.listDir(projectDir)) {
      if (n === keepBase || (keepSub && n === keepSub)) continue;
      rm(path.join(projectDir, n), "project entry");
    }
  } else {
    rm(projectDir, "project dir");
  }

  // 2) per-session references for every project session id
  for (const i of [...ids].sort()) {
    for (const p of fc.perSessionPaths(CLAUDE_DIR, i)) rm(p, `per-session (${i.slice(0, 8)})`);
  }

  // 3) sessions/*.json (PID→cwd map) pointing at this project
  if (fc.isDir(SESSIONS)) {
    for (const n of fc.listDir(SESSIONS)) {
      const p = path.join(SESSIONS, n);
      let txt = "";
      try { txt = fs.readFileSync(p, "utf8"); } catch { continue; }
      if (txt.includes(cwd) && !(preserveSid && txt.includes(preserveSid))) rm(p, "sessions map");
    }
  }

  if (doGlobals) {
    // 4) prompt history lines for this project (keep the preserved session's, if any)
    scrubJsonl(HISTORY, (o) => o.project === cwd && o.sessionId !== preserveSid, "history.jsonl");
    // 5) ~/.claude.json project entry (best-effort; backed up first)
    removeProjectFromJson(CLAUDE_JSON, cwd, "~/.claude.json", true);
    // 6) security audit log lines mentioning the path
    scrubTextLines(SECLOG, cwd, "security/log.txt");
    // 7) strip the project entry from rotating ~/.claude.json backups
    for (const bp of fc.backupsWithProject(BACKUPS, cwd)) removeProjectFromJson(bp, cwd, `backup ${path.basename(bp)}`);
  }

  if (finalize) dropFlag(flagPath); else updateFlag(flagPath, { heavy_done: true });
}

for (const { path: flagPath, data: flag } of flags) {
  try { processFlag(flagPath, flag); } catch { /* one bad flag shouldn't block the rest */ }
}
exit();
