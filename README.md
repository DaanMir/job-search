# 🔍 Job Scout — AI-Powered Job Screener for Product Managers

Local job screening system for Product Manager positions. Aggregates jobs from 12+ sources simultaneously, applies a hybrid scoring system (deterministic keyword matching + Groq LLaMA quality bonus), and ranks results so you can focus on what matters.

Built by a PM, for PMs — specifically tuned for senior remote roles in AI/LLM, fintech, and enterprise B2B.

---

## Quick Setup

### First time

```bash
# Backend
cd backend
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env with your API keys (at minimum: GROQ_API_KEY and APIFY_TOKEN)
node server.js

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Already installed

```bash
git pull

# Backend
cd backend
node server.js

# Frontend (new terminal)
cd frontend
npm run dev
```

Opens at **http://localhost:3000**

---

## Job Sources

| Source | Method | Key Required |
|--------|--------|--------------|
| **LinkedIn** | Apify Actor (`curious_coder/linkedin-jobs-scraper`) | ✅ `APIFY_TOKEN` |
| Remotive | Public API | ❌ |
| Himalayas | Public API | ❌ |
| WeWorkRemotely | RSS scraper | ❌ |
| Wellfound | Playwright scraper | ❌ |
| Jobspresso | Custom scraper | ❌ |
| WorkingNomads | Custom scraper | ❌ |
| EuroRemoteJobs | Custom scraper | ❌ |
| JSearch (Indeed + Glassdoor + more) | RapidAPI | ✅ `JSEARCH_API_KEY` (200 req/month free) |
| SerpAPI (Google Jobs) | API | ✅ `SERP_API_KEY` (100 req/month free) |

> LinkedIn jobs without a full description are automatically enriched via JSearch `job-details` — only for relevant titles, to preserve the monthly quota.

> URL validation runs on slug-based sources (Himalayas, Wellfound, etc.) to filter expired listings before scoring.

---

## Getting API Keys

| Key | Where | Cost |
|-----|-------|------|
| `GROQ_API_KEY` | https://console.groq.com | Free |
| `APIFY_TOKEN` | https://apify.com → Settings → Integrations → API tokens | Free tier: $5/month credit (~5,000 jobs) |
| `JSEARCH_API_KEY` | https://rapidapi.com → search "JSearch by OpenWeb Ninja" | Free: 200 req/month |
| `SERP_API_KEY` | https://serpapi.com | Free: 100 req/month |

---

## How Scoring Works

Hybrid scoring — two independent layers:

**Layer 1 — Deterministic base score (code only, no LLM)**

Scans title, description, and location for verifiable signals:
- Domain keywords: LLM, MCP, AI Agents, Open Finance, Fintech, Payments, Enterprise B2B, Observability, Azure
- Title match: Head of Product, Senior PM, Technical PM, Principal PM, etc.
- Location: EU-based (+15), Worldwide (+8), UK/CET (+8)
- Salary disclosed (+5), seniority explicit in title (+5)
- Relocation/residency requirement penalty (−15)
- Cap: 75 points

**Layer 2 — LLM quality bonus (Groq LLaMA 3.1, 0–25 points)**

Evaluates qualitative fit that code cannot measure:
- Actual product/problem domain fit
- Company stage and growth potential
- Role complexity and leadership scope
- Red flags not caught by keywords

**Final score = baseScore + qualityBonus (max 100)**

**Recommendation thresholds:**
- ≥ 75 → STRONG FIT
- ≥ 55 → GOOD FIT
- ≥ 35 → CONSIDER
- < 35 → SKIP

---

## Automatic Filters

Applied before scoring — no tokens spent:
- **Junior / Associate / Intern** titles → SKIP
- **On-site / office-only** roles → SKIP
- **US-only** roles → removed (checks patterns, US states, US cities in location)
- **Expired links** → filtered via HEAD request validation (slug-based sources only)

---

## How to Use

1. **Run Scan** — fetches from all sources, filters, scores, ranks
2. View **rankings** sorted by score — each card shows `baseScore + qualityBonus` breakdown
3. Expand a job to see highlights, matched skills, red flags, and LLM summary
4. Click **Mark as Applied** on jobs you apply to
5. Track status in the **Applications** tab (applied → interview → offer / rejected)
6. **History** tab loads any previous scan with full details

---

## Customize Your Profile

All search criteria live in **`backend/config.js`**:

- `PROFILE` — accepted/blocked titles, skills, deal breakers, salary targets
- `CANDIDATE_PROFILE` — your background, used by the LLM scorer to evaluate fit
- `LINKEDIN_SEARCH_QUERIES` — keywords and locations for LinkedIn via Apify (25 queries by default)
- `JSEARCH_QUERIES` — queries for JSearch/RapidAPI

Keyword weights and scoring rules are in **`backend/scorer.js`** → `DOMAIN_KEYWORDS` and `TITLE_SCORES`.

---

## Running Tests

```bash
cd backend
node --test scorer.test.js   # scoring logic smoke tests
node --test scraper.test.js  # US-only filter + dedup tests
```

No test framework needed — uses Node's built-in `node:test`.

---

## Architecture

```
backend/
  server.js        Express API (port 3001)
  scraper.js       Multi-source job fetcher + URL validator
  scorer.js        Hybrid scoring (deterministic + LLM)
  storage.js       Local JSON persistence + incremental scan cache
  config.js        All search queries and candidate profile
  utils/
    cache.js       In-memory scored job cache
    retry.js       Exponential backoff retry utility
    validator.js   Job schema validation
    env.validator  Startup env check

frontend/
  src/
    main.jsx       Vite entry point
    App.jsx        Main React app
    App.css        Dark-theme design system
  vite.config.js   Proxy to backend + .jsx resolution
```

- **Backend**: Node.js + Express (ESM)
- **Frontend**: React 18 + Vite (migrated from Create React App)
- **AI Scoring**: Groq LLaMA 3.1-8b-instant
- **Storage**: Local `data.json` (gitignored)
- **LinkedIn**: Apify Actor `curious_coder~linkedin-jobs-scraper`
