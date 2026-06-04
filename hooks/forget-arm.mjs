#!/usr/bin/env node
// forget-arm.mjs — arm (or cancel) a wipe for the CURRENT session or project.
// Writes a reversible flag; performs NO deletion. forget-cleanup.mjs does the work.
//   node forget-arm.mjs <session|project|cancel> [cancel]
import fs from "node:fs";
import path from "node:path";
import * as fc from "./forget-common.mjs";

const CLAUDE_DIR = fc.CLAUDE_DIR;
const PROJECTS = path.join(CLAUDE_DIR, "projects");
const FLAG = path.join(CLAUDE_DIR, "forget-pending.json");

const scope = process.argv[2] || "session";
const arg = process.argv[3] || "";

const out = (s) => process.stdout.write(s + "\n");

// Cancel disarms whatever is pending (session OR project) — one shared flag.
if (scope === "cancel" || arg === "cancel") {
  if (fs.existsSync(FLAG)) {
    try { fs.rmSync(FLAG, { force: true }); } catch { /* ignore */ }
    out("✗ Cancelled — the pending forget/nuke is disarmed. Nothing will be deleted.");
  } else {
    out("Nothing is armed; nothing to cancel.");
  }
  process.exit(0);
}

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const transcript = fc.newestTranscript(PROJECTS, cwd);
if (!transcript || !fs.existsSync(transcript)) {
  out("⚠️  Could not locate this session's transcript — nothing armed.");
  process.exit(0);
}

const sessionId = path.basename(transcript).replace(/\.jsonl$/, "");
const projDir = path.dirname(transcript);
const memDir = path.join(projDir, "memory");

if (scope === "project") {
  const history = path.join(CLAUDE_DIR, "history.jsonl");
  const seclog = path.join(CLAUDE_DIR, "security", "log.txt");
  const backups = path.join(CLAUDE_DIR, "backups");

  const ids = fc.projectSessionIds(projDir, history, cwd);
  const sessCount = fc.listDir(projDir).filter((n) => n.endsWith(".jsonl")).length;
  const memCount = fc.countFiles(memDir);
  const histCount = fc.countHistoryLines(history, cwd);
  const seclogCount = fc.countSecurityLogLines(seclog, cwd);
  const backupHits = fc.backupsWithProject(backups, cwd);

  let persess = 0;
  for (const i of ids) for (const p of fc.perSessionPaths(CLAUDE_DIR, i)) if (fc.exists(p)) persess++;

  const cj = fc.readJSON(fc.CLAUDE_JSON);
  const cjHas = !!(cj && cj.projects && typeof cj.projects === "object" &&
    Object.prototype.hasOwnProperty.call(cj.projects, cwd));

  fs.writeFileSync(FLAG, JSON.stringify({
    scope: "project", cwd, transcript,
    session_id: sessionId, project_dir: projDir, memory_dir: memDir,
  }));

  out("☢️  PROJECT NUKE armed (nothing deleted yet).");
  out(`   project: ${cwd}`);
  out("   This removes every Claude-realm reference to this project:");
  out(`     • sessions + memory     : ${projDir}/  (${sessCount} session(s), ${memCount} memory file(s))`);
  out(`     • per-session refs       : ${persess} file(s)/dir(s) across ${ids.size} session id(s)`);
  out("                                (session-env, file-history, tasks, security state)");
  out(`     • prompt history         : ${histCount} line(s) in history.jsonl`);
  out(`     • ~/.claude.json entry   : ${cjHas ? "yes — trust, allowedTools, mcpServers (best-effort, backed up)" : "none"}`);
  out(`     • security audit log     : ${seclogCount} line(s) in security/log.txt`);
  out(`     • config backups         : ${backupHits.length} backup file(s) scrubbed`);
  out("");
  out("   Your actual source files on disk are NOT touched — only Claude's data.");
  out("");
  out("To execute: CLOSE this session (Ctrl+D or /exit). The nuke runs on exit.");
  out("  (Note: /clear will NOT complete a project nuke — the live process re-creates");
  out("   the project. You must close the session.)");
  out("To back out:  /forget:cancel");
  process.exit(0);
}

// session scope
const memCount = fc.countFiles(memDir);
fs.writeFileSync(FLAG, JSON.stringify({
  scope: "session", transcript, session_id: sessionId, cwd, memory_dir: memDir,
}));

out("🧹 Forget armed for this session (nothing deleted yet).");
out(`   • transcript : ${transcript}`);
out(`   • memory     : ${memDir} (${memCount} file(s))`);
out("");
out("Press /clear to confirm: it wipes both and drops you into a fresh, 0-context session.");
out("Closing the session also triggers the wipe.");
out("To back out, run:  /forget:cancel");
