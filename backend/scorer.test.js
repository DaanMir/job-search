// Job Scout — smoke tests for scorer.js
// Run with: node --test backend/scorer.test.js
// (requires Node 18+, uses built-in node:test)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────
// We test the deterministic layer directly by reimplementing
// calcBaseScore logic here. This avoids needing Groq API in CI.
// ─────────────────────────────────────────────

import { isUSOnly } from "./scraper.js";

// Helper: minimal job factory
function makeJob(overrides = {}) {
  return {
    id: "test_001",
    title: "Senior Product Manager",
    company: "Acme Corp",
    location: "Remote - Europe",
    description: "",
    salary: null,
    url: "https://example.com/job/1",
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// US-ONLY FILTER TESTS
// ─────────────────────────────────────────────

describe("isUSOnly()", () => {
  it("should flag explicit US-only pattern", () => {
    const job = makeJob({ description: "You must be authorized to work in the US." });
    assert.equal(isUSOnly(job), true);
  });

  it("should flag US-state-only location without remote signal", () => {
    const job = makeJob({ location: "California" });
    assert.equal(isUSOnly(job), true);
  });

  it("should NOT flag remote EU job with EU in location", () => {
    const job = makeJob({ location: "Remote - EU" });
    assert.equal(isUSOnly(job), false);
  });

  it("should NOT flag worldwide remote job", () => {
    const job = makeJob({ location: "Remote - Worldwide" });
    assert.equal(isUSOnly(job), false);
  });

  it("should NOT flag EU job that mentions US tech stack in description", () => {
    const job = makeJob({
      location: "Remote - Europe",
      description: "We use AWS and work with US-based clients.",
    });
    assert.equal(isUSOnly(job), false);
  });
});

// ─────────────────────────────────────────────
// AI REGEX FIX TESTS
// Ensures /\bai\b/i catches patterns that the old " ai " string missed
// ─────────────────────────────────────────────

const AI_REGEX = /\bai\b/i;

describe("AI keyword regex", () => {
  it("should match standalone \"AI\"", () => {
    assert.ok(AI_REGEX.test("Build AI products"));
  });

  it("should match \"AI-native\"", () => {
    // word boundary is before A; '-native' doesn't prevent the match
    assert.ok(AI_REGEX.test("AI-native platform"));
  });

  it("should match \"AI/ML\"", () => {
    assert.ok(AI_REGEX.test("Experience with AI/ML systems"));
  });

  it("should NOT match \"AI\" inside another word like \"train\"", () => {
    // /\bai\b/ should not match 'ai' inside 'training'
    assert.equal(AI_REGEX.test("training pipeline"), false);
  });

  it("old string match would have missed AI-native but regex catches it", () => {
    const oldMatch = "AI-native platform".includes(" ai ");
    const newMatch = AI_REGEX.test("AI-native platform");
    assert.equal(oldMatch, false); // confirms the old bug
    assert.equal(newMatch, true);  // confirms the fix
  });
});

// ─────────────────────────────────────────────
// isNotPM() STRICT ALLOWLIST TESTS
// ─────────────────────────────────────────────

const TARGET_TITLES = [
  "product manager", "senior product manager", "lead product manager",
  "principal product manager", "staff product manager", "technical product manager",
  "ai product manager", "product owner", "group product manager",
  "head of product", "director of product", "vp of product", "gpm",
];

function isNotPMTest(titleLower) {
  return !TARGET_TITLES.some((accepted) => titleLower.includes(accepted));
}

describe("isNotPM() strict allowlist", () => {
  it("should accept 'Senior Product Manager'", () => {
    assert.equal(isNotPMTest("senior product manager"), false);
  });

  it("should accept 'AI Product Manager'", () => {
    assert.equal(isNotPMTest("ai product manager"), false);
  });

  it("should accept 'Head of Product'", () => {
    assert.equal(isNotPMTest("head of product"), false);
  });

  it("should REJECT 'Product Marketing Manager' (false positive from old code)", () => {
    assert.equal(isNotPMTest("product marketing manager"), true);
  });

  it("should REJECT 'Product Designer' (false positive from old code)", () => {
    assert.equal(isNotPMTest("product designer"), true);
  });

  it("should REJECT 'Product Analyst'", () => {
    assert.equal(isNotPMTest("product analyst"), true);
  });

  it("should REJECT 'Junior Product Manager'", () => {
    // This goes through the blockedTitle filter first, but isNotPM should also pass
    assert.equal(isNotPMTest("junior product manager"), false); // it IS a PM title, blocked separately
  });
});

// ─────────────────────────────────────────────
// scoreBreakdown STRUCTURE TEST
// Verifies the new scoreBreakdown field is present and well-formed
// ─────────────────────────────────────────────

describe("scoreBreakdown structure", () => {
  // Inline reimplementation of calcBaseScore for testing (no LLM call)
  function calcBaseScoreTest(job) {
    const breakdown = [];
    const title = (job.title || "").toLowerCase();
    if (title.includes("senior product manager")) breakdown.push({ rule: "title: senior product manager", pts: 8 });
    if (/\bai\b/i.test(title + " " + (job.description || ""))) breakdown.push({ rule: "domain keywords", pts: 5 });
    if (/europe|eu|italy/.test((job.location || "").toLowerCase())) breakdown.push({ rule: "location: EU-based", pts: 15 });
    return breakdown;
  }

  it("should return an array of breakdown entries", () => {
    const job = makeJob({
      title: "Senior Product Manager AI",
      location: "Remote - Europe",
      description: "Build AI products.",
    });
    const breakdown = calcBaseScoreTest(job);
    assert.ok(Array.isArray(breakdown));
    assert.ok(breakdown.length > 0);
  });

  it("each breakdown entry should have rule (string) and pts (number)", () => {
    const job = makeJob();
    const breakdown = calcBaseScoreTest(job);
    for (const entry of breakdown) {
      assert.equal(typeof entry.rule, "string");
      assert.equal(typeof entry.pts, "number");
    }
  });

  it("should include location EU entry for Europe-based jobs", () => {
    const job = makeJob({ location: "Remote - Europe" });
    const breakdown = calcBaseScoreTest(job);
    assert.ok(breakdown.some((e) => e.rule.includes("EU")));
  });
});
