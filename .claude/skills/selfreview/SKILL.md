---
name: selfreview
description: Review changed code for bugs, missing pieces, and unintended consequences. Enters plan mode to analyze before suggesting fixes.
---

# Self-Review Skill

Deep, skeptical review of your own recent changes. Find what you missed.

## Trigger

Run after completing any non-trivial coding task. The goal is to catch bugs,
missing edge cases, and unintended consequences before committing.

## Workflow

```
1. GATHER CHANGES (git diff, git log)
   ↓
2. ENTER PLAN MODE (read-only analysis)
   ↓
3. DEEP REVIEW (systematic, skeptical)
   ↓
4. REPORT FINDINGS
   ↓
5. ASK USER what to fix
   ↓
6. FIX (exit plan mode, apply fixes)
```

## Phase 1: Gather Changes

Understand the full scope of what changed. Run all of these:

```bash
# What files changed vs main
git diff --stat main...HEAD

# Full diff of all changes
git diff main...HEAD

# If there are unstaged changes too
git diff
git diff --cached

# Commit messages for context on intent
git log --oneline main...HEAD
```

If there are no commits beyond main, diff against the working tree:

```bash
git diff HEAD
git diff --cached
```

**Capture the intent**: Read commit messages to understand what the changes were
*supposed* to do. This is critical — you need to review against intent, not just
look for generic issues.

## Phase 2: Enter Plan Mode

Call `EnterPlanMode` to switch to read-only analysis. All investigation happens
here before proposing any changes.

**Do NOT repeat the original implementation plan in your new plan.** The
selfreview plan is a review checklist and findings report — not a copy of what
was just built. You may reference the original plan inline (e.g. "the config
loader change from step 4 of the original plan doesn't validate the new field")
when it helps the next implementer understand *what* you're referring to, but
never reproduce it wholesale.

## Phase 3: Deep Review

Be **adversarial**. Assume the code has bugs. Try to break it.

### 3a. Correctness Check

For each changed file, answer:

1. **Does this do what was intended?** Compare against commit message / task.
2. **Are there off-by-one errors?** Check loop bounds, slicing, array indexing.
3. **Are there null/undefined paths?** What if a config field is missing? A file doesn't exist?
4. **Are there type safety issues?** Unchecked casts, `as` assertions hiding real problems, missing type narrowing.
5. **Is the logic actually correct?** Trace through mentally with edge cases.

### 3b. Missing Pieces

For each change, ask:

1. **Missing error handling?** What if the file doesn't exist? Playwright times out? YAML is malformed?
2. **Missing validation?** New config fields without schema validation in `config/validator.ts`.
3. **Missing type definitions?** New interfaces not added to `types.ts` or `types/`.
4. **Missing CLI flags?** New features not exposed through Commander options.
5. **Missing report output?** New result states not shown in HTML or console reporters.
6. **Missing variable interpolation?** New string fields that should support `${VAR}` syntax.
7. **Missing schema updates?** Config changes not reflected in `config/schema.ts`.

### 3c. Unintended Consequences

Think about what else this change affects:

1. **Config compatibility** — Does this break existing `.megatest/` configs in target repos?
2. **Other commands** — Does a change in `run` affect `validate` or `accept`?
3. **Step execution** — Does a runner change affect all step types or just the intended one?
4. **Locator resolution** — Do locator changes affect all locator strategies?
5. **Report generation** — Do new result states render correctly in the HTML template?
6. **Exit codes** — Does this change affect CI integration (exit 0 vs exit 1)?
7. **Variable interpolation** — Does this break `${VAR}` or `${env:VAR}` substitution?
8. **Include resolution** — Does this affect circular include detection?
9. **Git integration** — Does this break commit hash or branch detection in `utils.ts`?
10. **Screenshot naming** — Does this change the `<checkpoint>-<viewport>.png` convention?

### 3d. Consistency Check

1. **Code style** — Does new code match the patterns in the same file?
2. **Naming** — Are new names consistent with existing conventions?
3. **Error messages** — Do they follow the project's existing error format?
4. **Imports** — Any unused imports added? Any needed imports missing?

### 3e. TypeScript-Specific Checks

1. **Strict mode compliance** — Does it compile cleanly with `strict: true`?
2. **Type narrowing** — Are union types properly narrowed before use?
3. **Exhaustiveness** — Do switch/if-else chains handle all cases? Use `never` checks?
4. **Promise handling** — Are async operations properly awaited? No floating promises?
5. **Module resolution** — Do imports use `NodeNext` resolution correctly (`.js` extensions)?
6. **Type exports** — Are new types exported for consumers?

## Phase 4: Report Findings

Present findings organized by severity. Be specific — include file:line references.

### Format

```markdown
## Self-Review Findings

### BUGS (will cause errors or wrong behavior)

1. **[file:line] Brief title**
   - What's wrong: ...
   - How to trigger: ...
   - Fix: ...

### MISSING (incomplete implementation)

1. **[file:line] Brief title**
   - What's missing: ...
   - Why it matters: ...
   - Fix: ...

### RISKY (might cause problems under certain conditions)

1. **[file:line] Brief title**
   - The risk: ...
   - When it triggers: ...
   - Mitigation: ...

### NITPICKS (minor, optional improvements)

1. **[file:line] Brief title**
   - Issue: ...
   - Suggestion: ...
```

**Rules for findings:**
- Every finding MUST have a specific file:line reference
- Every finding MUST explain *how* it would manifest (not just "might be a problem")
- Do NOT report things that are fine — only real issues
- Do NOT pad the report with generic advice
- If you find nothing, say so — an empty report is better than invented issues

## Phase 5: Ask User

Use `AskUserQuestion` to triage findings:

```yaml
questions:
  - question: "Found {N} issues in self-review. How should I proceed?"
    header: "Self-Review"
    multiSelect: false
    options:
      - label: "Fix all (Recommended)"
        description: "Fix {bugs} bugs, {missing} missing pieces, and {risky} risky items now."
      - label: "Fix bugs only"
        description: "Fix the {bugs} bugs. Skip missing pieces and risks."
      - label: "Show details first"
        description: "Walk through each finding before deciding."
      - label: "Skip all"
        description: "Accept the code as-is. No changes."
```

If user wants details, walk through findings one at a time with context.

## Phase 6: Fix

Exit plan mode and apply the agreed-upon fixes. After fixing:

1. Build: `npm run build`
2. If build passes, present the fixes for the user to review

## Tips

- **Be harsh on yourself.** The point is to catch what you missed, not to
  confirm everything is fine.
- **Trace data flow end-to-end.** Follow config YAML → loader → validator →
  engine → steps → screenshots → differ → reporter.
- **Check the negative path.** What happens when the config is malformed? When
  Playwright can't find the element? When the baseline doesn't exist?
- **Read surrounding code.** A change at line 50 might break something at line 200
  in the same file, or in a completely different file that imports from this one.
- **Think about config compatibility.** Users have existing `.megatest/` directories.
  Will your change break their configs silently?
- **Run the build in your head.** Before actually running `npm run build`, predict
  which type errors might appear and why.
