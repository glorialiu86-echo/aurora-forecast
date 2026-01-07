# Project Agent Rules (Aurora Capture)

This project is actively maintained by a human owner.
All agents (including Codex) must follow these rules strictly.

---

## 0. Absolute Priority (Hard Rules)
- ❌ Do NOT modify `main` branch unless the user explicitly says so
- ❌ Do NOT `commit` or `push` unless the user explicitly confirms
- ❌ Do NOT modify files outside the approved list
- ❌ Do NOT perform refactors unless explicitly requested

Violation of any hard rule = immediate rejection.

---

## 1. Branch & Deployment Rules (Very Important)
- `main` branch = production (www)
- `staging` branch = testing / preview
- **All changes must land in `staging` first**
- `staging` auto-deploys to aurora-capture-staging (GitHub Pages)
- `staging` must NOT introduce business-logic divergence from `main`
  - Only UI / testing / instrumentation differences are allowed

---

## 2. Mandatory REVIEW.md (Write Every Time)
For **every non-trivial change** (any code, logic, infra, or behavior change),
the agent **MUST generate a `REVIEW.md` file** in the repo root.

### 2.1 REVIEW.md is required BEFORE commit / push
- Changes are **NOT considered reviewable** without `REVIEW.md`
- The user will review `REVIEW.md` first, not raw diffs
- No `REVIEW.md` → no approval

### 2.2 REVIEW.md Fixed Template (Do NOT alter)
```md
# Review Summary

## What changed
- Bullet list of concrete changes (3–7 lines max)

## Files touched
- Modified:
- Added:
- Deleted:

## Behavior impact
- What user-visible behavior changed
- What explicitly did NOT change

## Risk assessment
- Possible failure modes
- Performance / cost / quota impact
- Deployment or environment risks

## How to test
1. Step-by-step manual test instructions
2. Expected results

## Rollback plan
- How to revert safely (e.g. revert commit / switch branch)

## Open questions / follow-ups
- Anything uncertain, deferred, or intentionally skipped
```

---

## 3. Before Coding (Mandatory)
Before writing **any code**, the agent must:
1. Summarize understanding of the task
2. List **exact files** to be modified or created
3. Explicitly state whether business logic is affected
4. Wait for explicit user confirmation

---

## 4. Code Modification Rules
- Use **full function** or **full block replacement**
- ❌ Do NOT insert scattered lines
- ❌ Do NOT do “cleanup”, “formatting”, or “small improvements” unless asked
- ❌ Do NOT rename files / variables / functions unless requested

---

## 5. Scope Control
- Only modify files explicitly approved by the user
- If a better solution exists:
  - Explain it
  - Wait for user decision
  - Do NOT auto-implement

---

## 6. Language & Style
- User instructions may be in Chinese
- Code, APIs, comments, and identifiers must be in English
- Markdown documentation must be clear, concise, and factual

---

## 7. Workflow Summary (TL;DR)
1. Explain plan → wait
2. Implement in `staging`
3. Generate `REVIEW.md`
4. User reviews `REVIEW.md`
5. Only then: commit / push (if approved)

Anything outside this flow is invalid.