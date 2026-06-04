#!/usr/bin/env node
// forget-cleanup.mjs — hook entrypoint for SessionStart and SessionEnd.
// If a wipe is armed and it's safe, perform it. Reads the hook payload on stdin.
//   scope=session → delete this session's transcript + project memory
//   scope=project → delete every Claude-realm reference to the project
// Set FORGET_DRY_RUN=1 to print planned actions instead of performing them.
import fs from "node:fs";
import path from "node:path";
import * as fc from "./forget-common.mjs";

const CLAUDE_DIR = fc.CLAUDE_DIR;
const FLAG = path.join(CLAUDE_DIR, "forget-pending.json");
const DRY = process.env.FORGET_DRY_RUN === "1";

const CLAUDE_JSON = fc.CLAUDE_JSON;
const HISTORY = path.join(CLAUDE_DIR, "history.jsonl");
const SECLOG = path.join(CLAUDE_DIR, "security", "log.txt");
const BACKUPS = path.join(CLAUDE_DIR, "backups");
const SESSIONS = path.join(CLAUDE_DIR, "sessions");

const log = (s) => process.stdout.write(s + "\n");
const exit = () => process.exit(0);

// Fast exit: nothing armed.
if (!fs.existsSync(FLAG)) exit();

let payload = "";
try { payload = fs.readFileSync(0, "utf8"); } catch { payload = ""; }

const flag = fc.readJSON(FLAG);
if (!flag) exit();
let ev = {};
if (payload.trim()) { try { ev = JSON.parse(payload); } catch { ev = {}; } }

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

const event = ev.hook_event_name || "";
const source = ev.source || "";
const evCwd = ev.cwd || process.cwd();
const evTx = ev.transcript_path || "";
const evSid = ev.session_id || "";

const scope = flag.scope || "session";
const fTx = flag.transcript || "";
const fSid = flag.session_id || "";
const fCwd = flag.cwd || "";

// Only act in the project the wipe was armed in.
if (fCwd && evCwd && rp(fCwd) !== rp(evCwd)) exit();

const sameAsActive = !!evTx && rp(evTx) === rp(fTx);

function dropFlag() {
  if (DRY) { log(`[dry-run] would remove flag: ${FLAG}`); return; }
  try { fs.rmSync(FLAG, { force: true }); } catch { /* ignore */ }
}
function updateFlag(extra) {
  if (DRY) { log(`[dry-run] keep flag, set: ${JSON.stringify(extra)}`); return; }
  try { const d = fc.readJSON(FLAG) || {}; Object.assign(d, extra); atomicWrite(FLAG, JSON.stringify(d)); } catch { /* ignore */ }
}

// ===========================================================================
// SESSION SCOPE
// ===========================================================================
if (scope === "session") {
  const fMem = flag.memory_dir || "";
  let finalize = true;
  if (event === "SessionStart") {
    if (source === "compact") exit();          // same session continues
    if (sameAsActive) {
      if (source === "resume") dropFlag();      // resumed armed session → cancel
      exit();
    }
    finalize = true;                            // startup / clear / resume-other → armed is closed
  } else if (event === "SessionEnd") {
    if (evSid && fSid && evSid !== fSid) exit();
    if (!evSid && evTx && !sameAsActive) exit();
    finalize = false;                           // delete now, keep flag for the ghost sweep
  } else {
    exit();
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
  if (finalize) dropFlag(); else updateFlag({ ghost_sweep: true });
  exit();
}

// ===========================================================================
// PROJECT SCOPE
// ===========================================================================
const projectDir = flag.project_dir || "";
const cwd = fCwd;
const heavyDone = !!flag.heavy_done;

let preserveSid = null;
let preserveTx = null;
let finalize = true;

if (event === "SessionEnd") {
  if (!((fSid && evSid && evSid === fSid) ||
        (evTx && rp(evTx) === rp(fTx)) ||
        (!evSid && !evTx))) exit();             // a different session ended
  finalize = false;                             // nuke now, keep flag for the ghost sweep
} else if (event === "SessionStart") {
  if (source === "resume" && sameAsActive) { dropFlag(); exit(); } // resumed armed → cancel
  if (source === "startup" || source === "resume") {
    preserveSid = evSid; preserveTx = evTx;     // keep the new session
    finalize = true;
  } else {
    exit();                                     // /clear and compact do NOT complete a project nuke
  }
} else {
  exit();
}

// On the follow-up ghost sweep (SessionEnd already did the heavy global scrubs)
// only clean leftover transcripts/per-session refs — don't re-scrub global config,
// so the freshly-reopened project's new ~/.claude.json entry survives.
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

if (finalize) dropFlag(); else updateFlag({ heavy_done: true });
exit();
