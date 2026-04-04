# description: Fix CI failures using plan-first root-cause analysis

## Usage

```
/fix [pr-number]
```

## Scope

This skill is strictly for fixing **CI/build failures** — format errors,
lint errors, type errors, test failures, Nix build failures. It is NOT
for general bug fixing or addressing review feedback (use `/resolve` for
review comments).

## Context Detection

- Triggered after CI failures (GitHub Actions, local `just ci-check`)
- Input: optional PR number to fetch CI logs from; otherwise uses local check output
- Requires: a failing check or build to investigate
- If there are no failures, report that and stop

## Workflow

1. **Fetch failure logs.** Get CI output from GitHub Actions or local check results.

   ```bash
   # From GitHub Actions
   gh run list --repo Eulesia/eulesia --branch <branch> --limit 3
   gh run view <run-id> --repo Eulesia/eulesia --log-failed
   ```

   Or run locally:

   ```bash
   just ci-check
   ```

   For **Nix build/check failures**, use nix-mcp to extract errors:

   ```
   mcp__nix-mcp__list_logs()                          # find available log IDs
   mcp__nix-mcp__build_errors(log_id="<log-id>")      # extract error lines with context
   mcp__nix-mcp__get_log(log_id="<id>", grep="error") # search large logs
   ```

2. **Analyze failures before making changes.**
   - Parse all error messages and warnings
   - Group failures into clusters by root cause
   - Identify dependency chains (e.g., a type error causing downstream test failures)
   - Map each cluster to affected files and modules

3. **Propose fixes.** For each failure cluster, produce:
   - Root cause description
   - Affected files
   - Proposed fix (code change, config change, dependency update)
   - Risk assessment (could this fix break something else?)

4. **Implement fixes.** Apply changes cluster by cluster, starting with the root cause that unblocks the most downstream failures.

5. **Re-run checks.**

   ```bash
   just ci-check
   ```

6. **Push if green.**

   ```bash
   git add <files> && git commit -m "<fix-description>"
   git push
   ```

   If checks still fail, loop back to step 2 with the new output.

## Decision Points

| Signal                                  | Action                                         |
| --------------------------------------- | ---------------------------------------------- |
| No failures found                       | Report clean status and stop                   |
| Single root cause, obvious fix          | Apply and verify                               |
| Multiple independent failures           | Fix in priority order (types > tests > lint)   |
| Failure in generated code or migrations | Check schema source, regenerate                |
| Flaky test                              | Identify flakiness, fix or mark as known-flaky |
| Unfamiliar failure domain               | Research before fixing, read related code      |
| Failure is from review feedback, not CI | Tell user to use `/resolve` instead            |

## Output Format

```
## Fix Report

### Failure Clusters

1. **<cluster-name>** (<N> errors)
   - Root cause: <description>
   - Files: <list>
   - Fix: <what was changed>
   - Status: <resolved | still failing>

### Checks After Fix

| Step       | Status |
|------------|--------|
| Format     | <pass/fail> |
| Lint       | <pass/fail> |
| Typecheck  | <pass/fail> |
| Test       | <pass/fail> |
| Build      | <pass/fail> |

### Commits

- `<hash>` <message>
```
