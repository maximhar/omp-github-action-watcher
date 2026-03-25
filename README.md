# @maximhar/omp-github-action-watch

Oh My Pi plugin for watching GitHub Actions workflow runs from an active OMP session.

It attaches a session-scoped watcher to a workflow run, polls GitHub periodically, and emits follow-up updates as the run moves through `queued`, `in_progress`, and `completed` states. Notifications include the workflow title, branch, commit SHA, run attempt, and the currently running or queued child jobs when GitHub exposes that context.

## Features

- Session-scoped workflow run watches
- Tool-driven start/stop controls
- Compact follow-up notifications inside OMP
- Expanded render with workflow metadata and job context
- Automatic cleanup when the session switches, branches, or shuts down
- Targeted test coverage for API mapping, rendering, and watch state transitions

## Requirements

- [Bun](https://bun.sh/) >= 1.3.7
- Oh My Pi / `@oh-my-pi/pi-coding-agent` v13
- GitHub CLI (`gh`) installed and authenticated with `gh auth login`

## Install

### From npm

Install the published package directly:

```bash
omp plugin install @maximhar/omp-github-action-watch
```

### Local development link

If you are iterating on the plugin locally:

```bash
cd /path/to/omp-github-action-watcher
bun install
bun link
omp plugin install @maximhar/omp-github-action-watch
```

You can also link the working tree directly:

```bash
omp plugin link /path/to/omp-github-action-watcher
```

## Usage

### Start watching a workflow run

```text
watch_github_action_run owner=payhawk repo=emi-service run_id=23532645155
```

### Stop watching

By watch id:

```text
stop_github_action_watch watch_id=<watch-id>
```

By repository + run id:

```text
stop_github_action_watch owner=payhawk repo=emi-service run_id=23532645155
```

### Inspect active watches inside OMP

```text
/github-action-watch list
/github-action-watch stop <watch-id>
```

## Development

```bash
bun install
bun run verify
```

The extension entry point is `src/extension.ts`.

## Release

- Pushes to `main` and pull requests run CI, verify the package, and build an npm tarball artifact.
- Publishing is handled by GitHub Actions when you publish a GitHub Release, or manually via the `Publish to npm` workflow.
- The publish workflow uses the repository `NPM_TOKEN` secret and runs `npm publish --provenance`.


## Repository layout

```text
src/
  extension.ts        # OMP extension registration and tool wiring
  github-api.ts       # GitHub CLI integration and workflow/job mapping
  render.ts           # Compact and expanded message rendering
  watch-format.ts     # Human-readable summaries and detail lines
  watch-registry.ts   # Polling, diffing, and lifecycle management
  types.ts            # Shared types

test/
  github-api.test.ts
  render.test.ts
  watch-registry.test.ts
```

## License

MIT
