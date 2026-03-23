import Groq from "groq-sdk";
import axios from "axios";
import { PROFILE } from "./config.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────
// CAMADA 1 — SCORE DETERMINÍSTICO (código puro)
// O código calcula baseScore baseado em critérios
// verificáveis na JD. Sem subjetividade do LLM.
// ─────────────────────────────────────────────

// Keywords de domínio com pesos — encontradas na JD/título
const DOMAIN_KEYWORDS = [
  // AI/ML — core do perfil
  { terms: ["llm", "large language model"], points: 8 },
  { terms: ["mcp", "model context protocol"], points: 8 },
  { terms: ["ai agent", "ai agents", "agentic"], points: 7 },
  { terms: ["machine learning", "ml platform"], points: 6 },
  { terms: ["artificial intelligence", " ai "], points: 5 },
  { terms: ["generative ai", "gen ai", "genai"], points: 6 },
  // Fintech/Open Finance — segundo core
  { terms: ["open finance", "open banking"], points: 8 },
  { terms: ["fintech", "financial technology"], points: 6 },
  { terms: ["payments", "payment platform"], points: 5 },
  { terms: ["banking", "neo bank", "neobank"], points: 4 },
  // Enterprise B2B — terceiro core
  { terms: ["enterprise b2b", "b2b saas"], points: 6 },
  { terms: ["enterprise platform", "enterprise product"], points: 5 },
  { terms: ["api platform", "developer platform"], points: 4 },
  // Monitoring/Observability — diferencial NTT Data
  { terms: ["observability", "monitoring platform"], points: 5 },
  { terms: ["microservices", "distributed systems"], points: 3 },
  // Tech stack familiar
  { terms: ["azure", "microsoft azure"], points: 3 },
  { terms: ["python", "c#", ".net"], points: 2 },
];

// Títulos alvo com pesos
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

// Localização — pontos por proximidade com EU timezone
const LOCATION_SCORES = {
  euBased: 15,      // EU/Europe explícito
  euTimezone: 10,   // CET/CEST, UK, +1/+2
  worldwide: 8,     // worldwide/global/anywhere
  usOnly: -999,     // bloqueio — tratado antes
};

function calcBaseScore(job) {
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const text = `${title} ${desc}`;

  let score = 0;
  const matched = [];

  // 1. Título match
  for (const { terms, points } of TITLE_SCORES) {
    if (terms.some((t) => title.includes(t))) {
      score += points;
      break; // só conta o melhor título match
    }
  }

  // 2. Domain keywords na JD (cap em 40 pontos)
  let domainPoints = 0;
  for (const { terms, points } of DOMAIN_KEYWORDS) {
    if (terms.some((t) => text.includes(t))) {
      domainPoints += points;
      matched.push(terms[0]);
    }
  }
  score += Math.min(domainPoints, 40);

  // 3. Localização
  if (/\beurope\b|\beuropean\b|\beu\b|\bremote.*eu\b|\bitaly\b|\bgermany\b|\bfrance\b|\bspain\b|\bnetherlands\b|\bportugal\b/.test(loc)) {
    score += LOCATION_SCORES.euBased;
  } else if (/worldwide|global|anywhere|anywhere in the world/.test(loc)) {
    score += LOCATION_SCORES.worldwide;
  } else if (/uk|united kingdom|london|\bcet\b|\bcest\b/.test(loc)) {
    score += LOCATION_SCORES.euTimezone;
  }

  // 4. Salário informado (presença já é sinal positivo)
  if (job.salary && job.salary !== "Not specified") {
    score += 5;
  }

  // 5. Seniority explícita no título
  if (/senior|lead|principal|head|director|vp |staff/.test(title)) {
    score += 5;
  }

  return { baseScore: Math.min(score, 75), matchedKeywords: matched };
}

// ─────────────────────────────────────────────
// CAMADA 2 — LLM avalia apenas fit qualitativo
// Recebe baseScore já calculado e retorna:
// qualityBonus (0-25), redFlags, highlights, summary
// ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a job fit evaluator. Your ONLY job is to assess qualitative fit between a job and a candidate profile, and return a quality bonus score.

The base score has ALREADY been calculated by the system based on keyword matching and location.
You must return a qualityBonus between 0-25 based on:
- How well the JD's actual product/problem domain matches the candidate's experience
- Company stage and growth potential (startup vs enterprise fit)
- Role complexity and leadership scope
- Red flags not caught by keyword matching (e.g. requires specific certifications, relocate, language requirements)

Candidate background (for context):
- Senior PM with AI/ML products, Open Finance (Mastercard), Enterprise monitoring (NTT Data/AmbevTech)
- Built multi-agent LLM frameworks and MCP servers independently
- EU-based (Italy), fluent English and Portuguese, basic Italian
- Looking for remote-first, senior IC or lead roles

You MUST respond ONLY with valid JSON, no markdown, no explanation.`;

const USER_PROMPT = (job, baseScore, matchedKeywords) => {
  const hasDescription = job.description && job.description.length > 100;
  const descSection = hasDescription
    ? `Job Description:\n${job.description.substring(0, 2500)}`
    : `Job Description: NOT AVAILABLE. Return qualityBonus of 0 since there is nothing to evaluate qualitatively.`;

  return `Base score already calculated: ${baseScore}/75
Matched keywords: ${matchedKeywords.join(", ") || "none"}

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

// ─────────────────────────────────────────────
// RECOMMENDATION calculada pelo código
// Baseada no score final — sem LLM decidir
// ─────────────────────────────────────────────
function calcRecommendation(score) {
  if (score >= 75) return "STRONG_FIT";
  if (score >= 55) return "GOOD_FIT";
  if (score >= 35) return "CONSIDER";
  return "SKIP";
}

// ─────────────────────────────────────────────
// PRE-FILTROS (código — sem gastar tokens)
// ─────────────────────────────────────────────

function isBlockedTitle(titleLower) {
  return PROFILE.dealBreakers.some((term) => titleLower.includes(term.toLowerCase()));
}

function isNotPM(titleLower) {
  const isPM = PROFILE.targetTitles.some((t) =>
    titleLower.includes(t.toLowerCase().split(" ").slice(-1)[0])
  );
  return !isPM && !titleLower.includes("product");
}

function isOnSite(job) {
  const loc = (job.location || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const terms = ["on-site", "onsite", "on site", "office only", "in-office",
    "must be in office", "no remote", "not remote"];
  return terms.some((t) => loc.includes(t) || desc.includes(t));
}

// ─────────────────────────────────────────────
// RETRY com backoff exponencial (rate limit)
// ─────────────────────────────────────────────
async function callLLMWithRetry(job, baseScore, matchedKeywords, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const chat = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: USER_PROMPT(job, baseScore, matchedKeywords) },
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

// ─────────────────────────────────────────────
// FETCH JD FALLBACK (páginas sem descrição)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// SCORE JOB — orquestra as duas camadas
// ─────────────────────────────────────────────
export async function scoreJob(job) {
  const titleLower = job.title?.toLowerCase() || "";

  // Pre-filtros — sem gastar tokens
  if (isBlockedTitle(titleLower)) {
    return {
      ...job,
      score: 0,
      recommendation: "SKIP",
      matchedSkills: [],
      highlights: [],
      redFlags: ["Title contains deal-breaker term"],
      salaryAssessment: "UNKNOWN",
      locationAssessment: "UNKNOWN",
      seniorityMatch: "UNDERQUALIFIED",
      summary: "Automatically filtered: junior or blocked title.",
      scored: true,
    };
  }

  if (isNotPM(titleLower)) return null;

  if (isOnSite(job)) {
    return {
      ...job,
      score: 0,
      recommendation: "SKIP",
      matchedSkills: [],
      highlights: [],
      redFlags: ["On-site or office-only role"],
      salaryAssessment: "UNKNOWN",
      locationAssessment: "ON_SITE",
      seniorityMatch: "UNKNOWN",
      summary: "Automatically filtered: on-site or office-only position.",
      scored: true,
    };
  }

  // Tenta buscar JD se não tem descrição
  let enrichedJob = { ...job };
  if ((!job.description || job.description.length < 100) && job.url) {
    const fetchedDesc = await fetchJobDescription(job.url);
    if (fetchedDesc && fetchedDesc.length > 100) {
      enrichedJob.description = fetchedDesc;
      console.log(`  📄 Fetched JD for "${job.title}" at ${job.company}`);
    }
  }

  // CAMADA 1 — baseScore determinístico
  const { baseScore, matchedKeywords } = calcBaseScore(enrichedJob);

  // CAMADA 2 — LLM qualityBonus
  const llmResult = await callLLMWithRetry(enrichedJob, baseScore, matchedKeywords);

  const qualityBonus = llmResult?.qualityBonus ?? 0;
  const finalScore = Math.min(baseScore + qualityBonus, 100);
  const recommendation = calcRecommendation(finalScore);

  return {
    ...enrichedJob,
    score: finalScore,
    baseScore,
    qualityBonus,
    recommendation,
    matchedSkills: matchedKeywords,
    highlights: llmResult?.highlights ?? [],
    redFlags: llmResult?.redFlags ?? [],
    salaryAssessment: llmResult?.salaryAssessment ?? "UNKNOWN",
    locationAssessment: llmResult?.locationAssessment ?? "UNKNOWN",
    seniorityMatch: llmResult?.seniorityMatch ?? "UNKNOWN",
    summary: llmResult?.summary ?? "",
    scored: true,
  };
}

// ─────────────────────────────────────────────
// SCORE ALL JOBS
// ─────────────────────────────────────────────
export async function scoreAllJobs(jobs) {
  console.log(`🤖 Scoring ${jobs.length} jobs (hybrid: deterministic + LLM quality bonus)...`);
  const scored = [];

  const batchSize = 3;
  const batchDelay = 4000;

  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(scoreJob));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) {
        scored.push(r.value);
      }
    }
    if (i + batchSize < jobs.length) {
      console.log(`  ⏳ Batch ${Math.ceil((i + batchSize) / batchSize)} done, waiting ${batchDelay / 1000}s...`);
      await new Promise((r) => setTimeout(r, batchDelay));
    }
  }

  // Filtra SKIP e score baixo, ordena por score desc
  const filtered = scored
    .filter((j) => j.recommendation !== "SKIP" && j.score >= 35)
    .sort((a, b) => b.score - a.score);

  // Log distribuição de scores para debug
  const dist = { "75-100": 0, "55-74": 0, "35-54": 0, "<35": 0 };
  scored.forEach((j) => {
    if (j.score >= 75) dist["75-100"]++;
    else if (j.score >= 55) dist["55-74"]++;
    else if (j.score >= 35) dist["35-54"]++;
    else dist["<35"]++;
  });
  console.log(`📊 Score distribution:`, dist);
  console.log(`✅ ${filtered.length} relevant jobs after scoring`);

  return filtered;
}
