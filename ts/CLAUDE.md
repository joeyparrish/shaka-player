# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

## Working Guidelines

### Workflow

- Use superpowers (brainstorm → plan → execute) for any non-trivial task
- Non-trivial = 3+ steps or architectural decisions
- If something goes sideways, STOP and re-plan immediately

### Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis
- For complex problems, throw more compute at it via subagents

### Code Quality

- Demand elegance: for non-trivial changes, pause and ask "is there a more
  elegant way?"
- Skip for simple, obvious changes — do not over-engineer
- Simplicity first: make every change as simple as possible, impact minimal code
- Find root causes — no temporary fixes, no workarounds
- Senior developer standards at all times
