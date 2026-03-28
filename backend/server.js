import "dotenv/config";
import express from "express";
import cors from "cors";
import { fetchAllJobs } from "./scraper.js";
import { scoreAllJobs } from "./scorer.js";
import {
  saveScannedJobs,
  getLatestScan,
  getAllScans,
  getScanById,
  saveApplication,
  updateApplication,
  getAllApplications,
} from "./storage.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Track per-source scraper health across the last scan
let lastScraperHealth = {};

// ─── HEALTH ───────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    scrapers: lastScraperHealth,
  });
});

// ─── SCAN ───────────────────────────────────────────
app.post("/api/scan", async (req, res) => {
  try {
    console.log("🚀 Starting job scan...");

    const { jobs: allJobs, scraperHealth } = await fetchAllJobs();
    lastScraperHealth = scraperHealth;

    console.log(`📊 Total jobs to score: ${allJobs.length}`);

    const scored = await scoreAllJobs(allJobs);
    const scan = saveScannedJobs(scored);
    res.json({
      success: true,
      scanId: scan.id,
      jobCount: scored.length,
      scraperHealth,
    });
  } catch (e) {
    console.error("Scan error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── SCANS ──────────────────────────────────────────
app.get("/api/scans", (req, res) => {
  res.json(getAllScans());
});

app.get("/api/scans/latest", (req, res) => {
  const scan = getLatestScan();
  if (!scan) return res.status(404).json({ error: "No scans yet" });
  res.json(scan);
});

app.get("/api/scans/:id", (req, res) => {
  const scan = getScanById(req.params.id);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  res.json(scan);
});

// ─── APPLICATIONS ───────────────────────────────
app.get("/api/applications", (req, res) => {
  res.json(getAllApplications());
});

app.post("/api/applications", (req, res) => {
  const { jobId, title, company, url, score, description, summary, highlights, matchedSkills, salary, notes } = req.body;
  if (!title || !company) return res.status(400).json({ error: "title and company required" });
  const application = saveApplication({ jobId, title, company, url, score, description, summary, highlights, matchedSkills, salary, notes });
  res.json(application);
});

app.patch("/api/applications/:id", (req, res) => {
  const updated = updateApplication(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Application not found" });
  res.json(updated);
});

app.listen(PORT, () => {
  console.log(`\n✅ Job Scout API running at http://localhost:${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   POST /api/scan         → Run a new job scan`);
  console.log(`   GET  /api/health       → API + scraper health status`);
  console.log(`   GET  /api/scans        → List all scan sessions`);
  console.log(`   GET  /api/scans/latest → Latest scan results`);
  console.log(`   GET  /api/applications → All applications`);
  console.log(`   POST /api/applications → Log a new application\n`);
});
