import Groq from "groq-sdk";
import axios from "axios";
import { PROFILE, CANDIDATE_PROFILE } from "./config.js";
import { getKnownJobIds, getCachedJob } from "./storage.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────
// CAMADA 1 — SCORE DETERMINÍSTICO (código puro)
// ─────────────────────────────────────────────

const DOMAIN_KEYWORDS = [
  { terms: ["llm", "large language model"], points: 8 },
  { terms: ["mcp", "model context protocol"], points: 8 },
  { terms: ["ai agent", "ai agents", "agentic"], points: 7 },
  { terms: ["machine learning", "ml platform"], points: 6 },
  { terms: ["artificial intelligence"], points: 5 },
  { terms: ["generative ai", "gen ai", "genai"], points: 6 },
  { terms: ["open finance", "open banking"], points: 8 },
  { terms: ["fintech", "financial technology"], points: 6 },
  { terms: ["payments", "payment platform"], points: 5 },
  { terms: ["banking", "neo bank", "neobank"], points: 4 },
  { terms: ["enterprise b2b", "b2b saas"], points: 6 },
  { terms: ["enterprise platform", "enterprise product"], points: 5 },
  { terms: ["api platform", "developer platform"], points: 4 },
  { terms: ["observability", "monitoring platform"], points: 5 },
  { terms: ["microservices", "distributed systems"], points: 3 },
  { terms: ["azure", "microsoft azure"], points: 3 },
  { terms: ["python", "c#", ".net"], points: 2 },
];

// Standalone AI keyword matched via regex (word boundary)
const AI_STANDALONE_REGEX = /\bai\b/i;
const AI_STANDALONE_POINTS = 5;

const TITLE_SCORES = [
  { terms: ["head of product", "vp of product", "vp product"], points: 12 },
  { terms: ["director of product", "director product"], points: 10 },
  { terms: ["principal product manager", "principal pm"], points: 10 },
  { terms: ["group product manager", "gpm"], points: 9 },
  { terms: ["lead product manager", "lead pm"], points: 8 },
  { terms: ["senior product manager", "senior pm", "sr. product manager"], points: 8 },
  { terms: ["technical product manager", "technical pm"], points: 9 },
  { terms: ["ai product manager", "ai pm"], points: 10 },
  { terms: ["product manager"], points: 5 },
  { terms: ["product owner"], points: 3 },
];

const RELOCATION_TERMS = [
  "requires relocation",
  "must relocate",
  "relocation required",
  "relocation assistance",
  "willing to relocate",
  "visa sponsorship not available",
  "no visa sponsorship",
  "right to work required",
  "must have right to work",
  "right to work in the uk",
  "right to work in uk",
  "local candidates only",
  "candidates must be based in",
  "must be based in",
  "must reside in",
  "must live in",
];

function calcBaseScore(job) {
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const text = `${title} ${desc}`;

  let score = 0;
  const matched = [];
  const penalties = [];
  const scoreBreakdown = [];

  // 1. Título match
  for (const { terms, points } of TITLE_SCORES) {
    if (terms.some((t) => title.includes(t))) {
      score += points;
      scoreBreakdown.push({ rule: `title: ${terms[0]}`, pts: points });
      break;
    }
  }

  // 2. Domain keywords (cap 40)
  let domainPoints = 0;
  for (const { terms, points } of DOMAIN_KEYWORDS) {
    if (terms.some((t) => text.includes(t))) {
      domainPoints += points;
      matched.push(terms[0]);
    }
  }

  // 2b. Standalone AI keyword via regex
  if (AI_STANDALONE_REGEX.test(text)) {
    const alreadyCreditedAI = matched.some((m) =>
      ["artificial intelligence", "generative ai", "gen ai", "genai", "ai agent", "ai agents", "agentic"].includes(m)
    );
    if (!alreadyCreditedAI) {
      domainPoints += AI_STANDALONE_POINTS;
      matched.push("ai (standalone)");
    }
  }

  const cappedDomain = Math.min(domainPoints, 40);
  score += cappedDomain;
  if (cappedDomain > 0) {
    scoreBreakdown.push({ rule: "domain keywords", pts: cappedDomain, matched: [...matched] });
  }

  // 3. Localização — UK reduzido para 8 (igual worldwide)
  let locPts = 0;
  let locRule = "";
  if (/\beurope\b|\beuropean\b|\beu\b|\bremote.*eu\b|\bitaly\b|\bgermany\b|\bfrance\b|\bspain\b|\bnetherlands\b|\bportugal\b/.test(loc)) {
    locPts = 15;
    locRule = "location: EU-based";
  } else if (/worldwide|global|anywhere|anywhere in the world/.test(loc)) {
    locPts = 8;
    locRule = "location: worldwide";
  } else if (/uk|united kingdom|london|\bcet\b|\bcest\b/.test(loc)) {
    locPts = 8;
    locRule = "location: UK/CET";
  }
  if (locPts > 0) {
    score += locPts;
    scoreBreakdown.push({ rule: locRule, pts: locPts });
  }

  // 4. Salário informado
  if (job.salary && job.salary !== "Not specified") {
    score += 5;
    scoreBreakdown.push({ rule: "salary disclosed", pts: 5 });
  }

  // 5. Seniority explícita
  if (/senior|lead|principal|head|director|vp |staff/.test(title)) {
    score += 5;
    scoreBreakdown.push({ rule: "seniority in title", pts: 5 });
  }

  // 6. Penalização por relocation
  const fullText = `${desc} ${loc}`;
  const hasRelocation = RELOCATION_TERMS.some((t) => fullText.includes(t));
  if (hasRelocation) {
    score -= 15;
    penalties.push("relocation");
    scoreBreakdown.push({ rule: "penalty: relocation/residency", pts: -15 });
  }

  return {
    baseScore: Math.max(0, Math.min(score, 75)),
    matchedKeywords: matched,
    penalties,
    scoreBreakdown,
  };
}

// ─────────────────────────────────────────────
// CAMADA 2 — LLM qualityBonus (0-25)
// ─────────────────────────────────────────────

function buildSystemPrompt() {
  const cp = CANDIDATE_PROFILE;
  return `You are a job fit evaluator. Your ONLY job is to assess qualitative fit between a job and a candidate profile, and return a quality bonus score.

The base score has ALREADY been calculated by the system based on keyword matching and location.
You must return a qualityBonus between 0-25 based on:
- How well the JD's actual product/problem domain matches the candidate's experience
- Company stage and growth potential (startup vs enterprise fit)
- Role complexity and leadership scope
- Red flags not caught by keyword matching (e.g. requires specific certifications, language requirements, relocation)

Candidate background:
- ${cp.seniority}
- Key achievements: ${cp.highlights.join("; ")}
- Tech stack: ${cp.techStack.join(", ")}
- Location: ${cp.location}
- Languages: ${cp.languages}
- Target: ${cp.targetRoles}
- Domain fit: ${cp.domainFit.join(", ")}

You MUST respond ONLY with valid JSON, no markdown, no explanation.`;
}

const USER_PROMPT = (job, baseScore, matchedKeywords, penalties) => {
  const hasDescription = job.description && job.description.length > 100;
  const descSection = hasDescription
    ? `Job Description:\n${job.description.substring(0, 2500)}`
    : `Job Description: NOT AVAILABLE. Return qualityBonus of 0.`;

  const penaltyNote = penalties.length > 0
    ? `\nNote: System already penalized -15 for: ${penalties.join(", ")}. Do NOT double-penalize.`
    : "";

  return `Base score already calculated: ${baseScore}/75
Matched keywords: ${matchedKeywords.join(", ") || "none"}${penaltyNote}

Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Salary: ${job.salary || "Not specified"}

${descSection}

Return ONLY this JSON:
{
  "qualityBonus": <0-25 integer>,
  "highlights": ["key point 1", "key point 2"],
  "redFlags": ["flag1"] or [],
  "salaryAssessment": "<ABOVE_TARGET | AT_TARGET | BELOW_TARGET | UNKNOWN>",
  "locationAssessment": "<EU_BASED | EU_TIMEZONE | WORLDWIDE | ON_SITE>",
  "seniorityMatch": "<PERFECT | GOOD | OVERQUALIFIED | UNDERQUALIFIED>",
  "summary": "<2 sentence summary focused on qualitative fit>"
}`;
};

function calcRecommendation(score) {
  if (score >= 75) return "STRONG_FIT";
  if (score >= 55) return "GOOD_FIT";
  if (score >= 35) return "CONSIDER";
  return "SKIP";
}

function isBlockedTitle(titleLower) {
  return PROFILE.dealBreakers.some((term) => titleLower.includes(term.toLowerCase()));
}

// FIX: strict allowlist — no more broad 'product' fallback
function isNotPM(titleLower) {
  const acceptedTerms = PROFILE.targetTitles.map((t) => t.toLowerCase());
  return !acceptedTerms.some((accepted) => titleLower.includes(accepted));
}

function isOnSite(job) {
  const loc = (job.location || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const terms = ["on-site", "onsite", "on site", "office only", "in-office",
    "must be in office", "no remote", "not remote"];
  return terms.some((t) => loc.includes(t) || desc.includes(t));
}

async function callLLMWithRetry(job, baseScore, matchedKeywords, penalties, maxRetries = 3) {
  const systemPrompt = buildSystemPrompt();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const chat = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: USER_PROMPT(job, baseScore, matchedKeywords, penalties) },
        ],
        temperature: 0.1,
        max_tokens: 400,
      });
      const raw = chat.choices[0]?.message?.content || "{}";
      return JSON.parse(raw);
    } catch (e) {
      const isRateLimit = e?.status === 429 || e?.message?.includes("rate limit") || e?.message?.includes("429");
      const isLastAttempt = attempt === maxRetries;
      if (isRateLimit && !isLastAttempt) {
        const waitMs = 5000 * Math.pow(2, attempt - 1);
        console.warn(`  ⏳ Rate limit — waiting ${waitMs / 1000}s (attempt ${attempt}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.error(`LLM error for "${job.title}":`, e.message);
      return null;
    }
  }
  return null;
}

async function fetchJobDescription(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    const html = res.data || "";
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const descMatch = text.match(/(?:about the (?:role|job|position)|responsibilities|what you.ll do|job description|role overview)(.{200,3000})/i);
    return descMatch ? descMatch[0].substring(0, 2500) : text.substring(0, 2500);
  } catch {
    return null;
  }
}

export async function scoreJob(job) {
  const titleLower = job.title?.toLowerCase() || "";

  if (isBlockedTitle(titleLower)) {
    return {
      ...job, score: 0, recommendation: "SKIP", matchedSkills: [], highlights: [],
      redFlags: ["Title contains deal-breaker term"], salaryAssessment: "UNKNOWN",
      locationAssessment: "UNKNOWN", seniorityMatch: "UNDERQUALIFIED",
      summary: "Automatically filtered: junior or blocked title.",
      scoreBreakdown: [{ rule: "blocked title", pts: 0 }],
      scored: true,
    };
  }

  if (isNotPM(titleLower)) return null;

  if (isOnSite(job)) {
    return {
      ...job, score: 0, recommendation: "SKIP", matchedSkills: [], highlights: [],
      redFlags: ["On-site or office-only role"], salaryAssessment: "UNKNOWN",
      locationAssessment: "ON_SITE", seniorityMatch: "UNKNOWN",
      summary: "Automatically filtered: on-site or office-only position.",
      scoreBreakdown: [{ rule: "on-site filtered", pts: 0 }],
      scored: true,
    };
  }

  let enrichedJob = { ...job };
  if ((!job.description || job.description.length < 100) && job.url) {
    const fetchedDesc = await fetchJobDescription(job.url);
    if (fetchedDesc && fetchedDesc.length > 100) {
      enrichedJob.description = fetchedDesc;
      console.log(`  📄 Fetched JD for "${job.title}" at ${job.company}`);
    }
  }

  const { baseScore, matchedKeywords, penalties, scoreBreakdown } = calcBaseScore(enrichedJob);
  const llmResult = await callLLMWithRetry(enrichedJob, baseScore, matchedKeywords, penalties);

  const qualityBonus = llmResult?.qualityBonus ?? 0;
  const finalScore = Math.min(baseScore + qualityBonus, 100);
  const recommendation = calcRecommendation(finalScore);

  const autoRedFlags = penalties.includes("relocation")
    ? ["Relocation or residency requirement detected"]
    : [];

  return {
    ...enrichedJob,
    score: finalScore,
    baseScore,
    qualityBonus,
    recommendation,
    matchedSkills: matchedKeywords,
    highlights: llmResult?.highlights ?? [],
    redFlags: [...autoRedFlags, ...(llmResult?.redFlags ?? [])],
    salaryAssessment: llmResult?.salaryAssessment ?? "UNKNOWN",
    locationAssessment: llmResult?.locationAssessment ?? "UNKNOWN",
    seniorityMatch: llmResult?.seniorityMatch ?? "UNKNOWN",
    summary: llmResult?.summary ?? "",
    scoreBreakdown,
    scored: true,
  };
}

export async function scoreAllJobs(jobs) {
  // ─── INCREMENTAL SCAN: skip jobs already processed in previous scans ───
  const knownIds = getKnownJobIds();
  const newJobs = jobs.filter((j) => !knownIds.has(j.id));
  const cachedJobs = jobs
    .filter((j) => knownIds.has(j.id))
    .map((j) => getCachedJob(j.id))
    .filter(Boolean);

  console.log(`🤖 Scoring ${newJobs.length} new jobs (${cachedJobs.length} retrieved from cache, ${jobs.length} total)...`);

  const scored = [];
  const batchSize = 3;
  const batchDelay = 4000;

  for (let i = 0; i < newJobs.length; i += batchSize) {
    const batch = newJobs.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(scoreJob));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) scored.push(r.value);
    }
    if (i + batchSize < newJobs.length) {
      console.log(`  ⏳ Batch ${Math.ceil((i + batchSize) / batchSize)} done, waiting ${batchDelay / 1000}s...`);
      await new Promise((r) => setTimeout(r, batchDelay));
    }
  }

  // Merge new scored + cached
  const allScored = [...scored, ...cachedJobs];

  const filtered = allScored
    .filter((j) => j.recommendation !== "SKIP" && j.score >= 35)
    .sort((a, b) => b.score - a.score);

  const dist = { "75-100": 0, "55-74": 0, "35-54": 0, "<35": 0 };
  allScored.forEach((j) => {
    if (j.score >= 75) dist["75-100"]++;
    else if (j.score >= 55) dist["55-74"]++;
    else if (j.score >= 35) dist["35-54"]++;
    else dist["<35"]++;
  });
  console.log(`📊 Score distribution:`, dist);
  console.log(`✅ ${filtered.length} relevant jobs after scoring (${cachedJobs.length} from cache)`);
  return filtered;
}
