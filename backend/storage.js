import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "data.json");

// ─────────────────────────────────────────────
// SCHEMA MIGRATION
// Increment CURRENT_SCHEMA_VERSION whenever you add new fields to job objects.
// Add a migration step in migrateJob() for each version bump.
// ─────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 3;

/**
 * Migrate a single job object to the current schema.
 * Called on every job loaded from disk to ensure backwards compatibility.
 */
function migrateJob(job) {
  // v1 → v2: added baseScore, qualityBonus, scoreBreakdown
  if (job.baseScore === undefined) {
    job.baseScore = job.score ?? 0;
  }
  if (job.qualityBonus === undefined) {
    job.qualityBonus = 0;
  }
  if (job.scoreBreakdown === undefined) {
    job.scoreBreakdown = [];
  }

  // v2 → v3: added penalties, seniorityMatch, locationAssessment, salaryAssessment
  if (job.penalties === undefined) {
    job.penalties = [];
  }
  if (job.seniorityMatch === undefined) {
    job.seniorityMatch = "UNKNOWN";
  }
  if (job.locationAssessment === undefined) {
    job.locationAssessment = "UNKNOWN";
  }
  if (job.salaryAssessment === undefined) {
    job.salaryAssessment = "UNKNOWN";
  }
  if (job.highlights === undefined) {
    job.highlights = [];
  }
  if (job.redFlags === undefined) {
    job.redFlags = [];
  }
  if (job.matchedSkills === undefined) {
    job.matchedSkills = [];
  }
  if (job.summary === undefined) {
    job.summary = "";
  }

  return job;
}

function loadDB() {
  if (!existsSync(DB_PATH)) {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, scans: [], applications: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(DB_PATH, "utf-8"));
    // Migrate all jobs in all scans on load
    if (raw.scans) {
      raw.scans = raw.scans.map((scan) => ({
        ...scan,
        jobs: (scan.jobs || []).map(migrateJob),
      }));
    }
    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
    return raw;
  } catch {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, scans: [], applications: [] };
  }
}

function saveDB(db) {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ─────────────────────────────────────────────
// INCREMENTAL SCAN SUPPORT
// Returns IDs already processed in previous scans.
// Used by scoreAllJobs to skip re-processing known jobs.
// ─────────────────────────────────────────────
export function getKnownJobIds() {
  const db = loadDB();
  const ids = new Set();
  for (const scan of db.scans) {
    for (const job of (scan.jobs || [])) {
      if (job.id) ids.add(job.id);
    }
  }
  return ids;
}

export function getCachedJob(id) {
  const db = loadDB();
  for (const scan of db.scans) {
    const found = (scan.jobs || []).find((j) => j.id === id);
    if (found) return found;
  }
  return null;
}

export function saveScannedJobs(jobs) {
  const db = loadDB();

  const sortedJobs = [...jobs].sort((a, b) => (b.score || 0) - (a.score || 0));

  const scan = {
    id: Date.now(),
    scannedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    jobCount: sortedJobs.length,
    jobs: sortedJobs,
  };
  db.scans.unshift(scan);
  if (db.scans.length > 10) db.scans = db.scans.slice(0, 10);
  saveDB(db);
  return scan;
}

export function getLatestScan() {
  const db = loadDB();
  return db.scans[0] || null;
}

export function getAllScans() {
  const db = loadDB();
  return db.scans.map((s) => ({
    id: s.id,
    scannedAt: s.scannedAt,
    jobCount: s.jobCount,
  }));
}

export function getScanById(id) {
  const db = loadDB();
  return db.scans.find((s) => s.id === Number(id)) || null;
}

export function saveApplication(application) {
  const db = loadDB();
  const app = {
    id: Date.now(),
    appliedAt: new Date().toISOString(),
    status: "applied",
    ...application,
  };
  db.applications.unshift(app);
  saveDB(db);
  return app;
}

export function updateApplication(id, updates) {
  const db = loadDB();
  const idx = db.applications.findIndex((a) => a.id === Number(id));
  if (idx === -1) return null;
  db.applications[idx] = { ...db.applications[idx], ...updates };
  saveDB(db);
  return db.applications[idx];
}

export function getAllApplications() {
  const db = loadDB();
  return db.applications;
}
