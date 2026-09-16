# Eunoia release safety

These rules are mandatory for every Eunoia edit, build, rollback, and deployment.

- Treat the freshly fetched `origin/main` as the only release baseline. Before changing or deploying anything, run `git fetch origin --prune`.
- Never build or deploy from a long-lived working directory, a detached stale branch, or any commit behind `origin/main`. In particular, do not release from `/root/eunoia-app` unless its base has been proven current.
- Create a clean isolated worktree from the latest `origin/main`, then apply only the requested minimal changes there. Existing dirty worktrees are evidence sources only, never release sources.
- Immediately before deployment, fetch again and require the current release commit to contain the latest `origin/main` (`git merge-base --is-ancestor origin/main HEAD`). If the remote advanced, rebuild the change on the new tip before deploying.
- Review the complete diff against `origin/main`. Do not restore a feature by copying an older bundle, branch, or whole file over newer code; port the smallest relevant hunks onto the latest baseline.
- Preserve every newer production fix and feature unless the user explicitly asks to remove it. A fix for one feature must not regress unrelated behavior.
- Run the appropriate full tests and production build from the release worktree. Deploy only after they pass.
- For backend changes, preserve the resident Claude session whenever possible: validate as the runtime user and use `/opt/ai-companion/scripts/reload-channel.sh` for a hot reload when the channel proxy is healthy. Restart the brain/service only when the change cannot be applied safely by hot reload (for example supervisor, proxy, bootstrap, or environment changes), and state the specific reason before restarting.
- After deployment, verify the custom production domain serves the new asset and check the critical behavior touched by both the new change and recent production fixes.
- If the current baseline, diff, or production provenance cannot be proven, do not deploy. Resolve that uncertainty first.
