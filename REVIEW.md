# Review Summary

## What changed
- Rewrote external-facing model explanation to clarify decision layers, time-scale non-interchangeability, and model stance
- Added internal whitebox documentation aligned with model.js for maintenance and audit
- Added a public-facing model explanation document with conceptual formulas/flow
- Bumped cache/version tokens in index.html from 0323 to 0324

## Files touched
- Modified: index.html, REVIEW.md
- Added: MODEL_EXPLANATION.md, MODEL_WHITEBOX.md
- Deleted:

## Behavior impact
- What user-visible behavior changed: Documentation content updated; asset cache/version tokens updated
- What explicitly did NOT change: No model or runtime logic changes

## Risk assessment
- Possible failure modes: Stale references if any version token was missed
- Performance / cost / quota impact: None
- Deployment or environment risks: Low

## How to test
1. Open `MODEL_EXPLANATION.md` and confirm the external-facing structure and messaging are correct
2. Open `MODEL_WHITEBOX.md` and verify it matches `model.js`
3. Open `index.html` and confirm all `?v=0324` and `v3.0.0324` occurrences updated consistently

## Rollback plan
- Revert the commit on `staging`

## Open questions / follow-ups
- None
