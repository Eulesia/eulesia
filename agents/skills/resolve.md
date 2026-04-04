# description: Address PR review comments and resolve them

## Usage

```
/resolve <pr-number>
```

## Context Detection

- Triggered after receiving review feedback on a pull request
- Input: PR number in the upstream repo
- Requires: an open PR with review comments

## Workflow

1. **Fetch review comments.** Use these exact commands to pull all comment types:

   ```bash
   # PR-level review comments (inline code comments from reviewers)
   gh api repos/Eulesia/eulesia/pulls/<pr-number>/comments \
     --jq '.[] | {id: .id, path: .path, line: .line, body: .body}'

   # PR review summaries (approve/request-changes bodies)
   gh api repos/Eulesia/eulesia/pulls/<pr-number>/reviews \
     --jq '.[] | {id: .id, state: .state, body: .body}'

   # PR conversation comments (non-inline discussion)
   gh api repos/Eulesia/eulesia/issues/<pr-number>/comments \
     --jq '.[] | {id: .id, body: .body, user: .user.login}'
   ```

   All three must be checked — reviewers use different comment types.

2. **Normalize comments into a task list.** For each comment:
   - Extract the request or concern
   - Identify the file and line (from `path` + `line` fields)
   - Classify: blocking, code-change, suggestion, nit, question
   - Assign a number for tracking

3. **Implement fixes.** Address each comment individually.
   - Blocking comments first
   - Code changes second
   - Nits and suggestions last
   - Questions: reply inline, no code change needed

4. **Re-run checks.**

   ```bash
   just ci-check
   ```

5. **Commit and push.**

   ```bash
   git add <files> && git commit -m "fix: address review feedback"
   git push
   ```

6. **Reply to each comment and resolve the thread.** This is critical —
   every review comment must get a reply AND be resolved. Do this for
   ALL addressed comments, not just a summary.

   **Step A — Get thread IDs** (maps comment IDs to resolvable thread IDs):

   ```bash
   gh api graphql -f query='
     { repository(owner: "Eulesia", name: "eulesia") {
       pullRequest(number: <pr-number>) {
         reviewThreads(first: 100) {
           nodes {
             id
             isResolved
             comments(first: 1) { nodes { body databaseId } }
           }
         }
       }
     }}'
   ```

   **Step B — Reply to each comment:**

   ```bash
   # Reply to an inline review comment
   gh api repos/Eulesia/eulesia/pulls/<pr-number>/comments/<comment-id>/replies \
     -f body="Fixed in <commit-hash>: <one-line description>"
   ```

   For deferred items, reply explaining why and when it will be addressed.

   **Step C — Resolve each addressed thread:**

   ```bash
   gh api graphql -f query='
     mutation {
       resolveReviewThread(input: {threadId: "<PRRT_thread_id>"}) {
         thread { isResolved }
       }
     }'
   ```

   Do NOT resolve threads for deferred items — leave them open.

7. **Post summary comment.** After all individual replies and resolutions,
   add one summary listing everything:

   ```bash
   gh pr comment <pr-number> --repo Eulesia/eulesia --body "$(cat <<'EOF'
   ## Review feedback addressed

   | # | Comment | Status |
   |---|---------|--------|
   | 1 | <one-line summary> | Resolved in <hash> |
   | 2 | <one-line summary> | Resolved in <hash> |
   | 3 | <one-line summary> | Deferred — <reason> |

   ### Deferred items
   - <item>: <why deferred, when it will be addressed>
   EOF
   )"
   ```

## Decision Points

| Signal                                          | Action                                       |
| ----------------------------------------------- | -------------------------------------------- |
| Comment is a question, no code change needed    | Reply with explanation, resolve thread       |
| Comment requests design change                  | Evaluate scope; escalate to `/plan` if large |
| Comment about missing tests                     | Write the tests                              |
| Comment about naming/style                      | Apply the suggestion                         |
| Contradictory comments from different reviewers | Flag and ask for clarification               |
| Comment already fixed in a prior commit         | Reply citing the commit hash, resolve thread |

## Output Format

```
## Resolve Report

### Comments Addressed

| # | Comment | Type | File | Status | Resolved |
|---|---------|------|------|--------|----------|
| 1 | <summary> | blocking | <file:line> | Fixed in <hash> | yes |
| 2 | <summary> | suggestion | <file:line> | Fixed in <hash> | yes |
| 3 | <summary> | nit | <file:line> | Deferred | no |

### Deferred

- <item>: <reason and timeline>
```
