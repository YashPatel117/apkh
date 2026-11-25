# Project rules (all agents, all tools, all models)

<!-- agent-kit: this file is read by Claude Code (via CLAUDE.md), Codex, Cursor, Copilot, Gemini CLI and others.
     /setup-agents fills the FILL sections. Edit freely afterwards. -->

## Project
<!-- FILL:project — one paragraph: what the app is, who uses it. -->
_Not configured yet — run `/setup-agents` in Claude Code._

## Stack
<!-- FILL:stack — one row per area: area | tech + version | folder | build | test | lint -->

## Repository layout
<!-- FILL:layout — tree of top-level folders with one line each. -->

## Single source of truth
<!-- FILL:contract — if the project has a cross-boundary contract (OpenAPI, GraphQL schema,
     .proto, shared types package, DB schema), name the file, the generated folders, and the
     codegen command. Otherwise write "No shared contract; the feature plan is the contract." -->
- The feature plan in `docs/plans/<feature>.md` pins down every name that crosses agent boundaries (interfaces, function signatures, component members, events). Follow it exactly — same names, same signatures.
- Never edit generated code. Need a change? Report it; the orchestrator updates the source and regenerates.

## Ownership
Each agent edits **only** the paths it owns — see `docs/ownership.md`. Reading anything is fine.

## Forbidden for sub-agents (orchestrator only)
- git commands of any kind
- installing/removing packages or editing dependency manifests
- running code generation
- starting dev servers / long-running processes
- full builds or the full test suite — use the quick check for your own area instead

If you need any of these, put it under **"Needs from orchestrator"** in your final report and continue.

## Conventions
<!-- FILL:conventions — per area: language level, style, patterns, naming, error handling, testing. -->
- No secrets in code.

## Final report format (every sub-agent)
```
## Done
- files created/changed
## Assumptions
## Needs from orchestrator
- (packages, contract changes, wiring, anything outside my ownership)
## Quick check result
```
