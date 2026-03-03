# 🔍 Job Scout — AI-Powered Job Screener for Product Managers

Local job screening system for Product Manager positions with AI scoring using Groq (LLaMA 3.1).

## Quick Setup (5 minutes)

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your API keys
node server.js
```

### 2. Frontend (new terminal)
```bash
cd frontend
npm install
npm start
```

Opens at **http://localhost:3000**

---

## Job Sources

| Source | Method | Limit | Key Required |
|--------|--------|-------|--------------|
| Remotive | Public API | Unlimited | ❌ |
| Himalayas | Public API | Unlimited | ❌ |
| **LinkedIn Direct** | npm public scraping | Unlimited | ❌ |
| **WeWorkRemotely** | Custom RSS scraper | Unlimited | ❌ |
| **Wellfound** | Custom Playwright scraper | Unlimited | ❌ |
| **Jobspresso** | Custom scraper | Unlimited | ❌ |
| **WorkingNomads** | Custom scraper | Unlimited | ❌ |
| **EuroRemoteJobs** | Custom scraper | Unlimited | ❌ |
| **JSearch** (LinkedIn + Indeed + Glassdoor) | RapidAPI | 200 req/month free | ✅ JSEARCH_API_KEY |
| SerpAPI (Google Jobs) | API | 100 req/month free | ✅ SERP_API_KEY (backup) |

> WeWorkRemotely uses public RSS — very stable.
> Wellfound uses Playwright (headless browser) — requires Chromium installation once.

---

## Getting API Keys

| Key | Where |
|-----|-------|
| `GROQ_API_KEY` | https://console.groq.com |
| `JSEARCH_API_KEY` | https://rapidapi.com → search "JSearch by OpenWeb Ninja" → Subscribe Free |
| `SERP_API_KEY` | https://serpapi.com (backup, you may already have it) |

---

## How to Use

1. **Run Scan** — searches jobs across all sources, Groq scores each job description
2. View **ranking** with score, highlights, and red flags for each job
3. Click **Mark as Applied** on jobs you apply to
4. Track status in **Applications** tab (applied → interview → offer / rejected)
5. **History** tab loads any previous scan with saved job descriptions

---

## Customize Criteria

Edit **`backend/config.js`** to adjust:
- Accepted / blocked job titles
- Priority skills
- Minimum salary range
- Deal breakers
- Search queries

---

## Architecture

- **Backend**: Node.js + Express API (port 3001)
- **Frontend**: React (port 3000, proxied to backend)
- **AI Scoring**: Groq LLaMA 3.1-8b-instant
- **Storage**: Local JSON file (data.json)
- **Scraping**: Mix of public APIs, RSS feeds, and Playwright
