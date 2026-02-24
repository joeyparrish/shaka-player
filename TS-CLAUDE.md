# Shaka Player — TypeScript Migration Context

The full migration plan is in **`ts-transition.md`** (~2000 lines). This file records key decisions and open questions for quick reference during migration sessions.

## Key Decisions (rationale in ts-transition.md)

| Decision | Choice | Rejected alternatives |
|----------|--------|-----------------------|
| Build system | Wireit + Rollup + tsc | Bazel (not community-standard), Python scripts |
| Type generation | Custom `scripts/generate-externs.js` | tsickle (unsupported since Nov 2022) |
| Module conversion | `goog.provide` → `goog.module` (Phase 0) → ES modules (Phase 1) | Going directly to ES modules (incompatible with goog.provide/require) |
| Bundler | Rollup + Terser | Closure bundling |
| During transition | Closure in type-check-only mode | N/A |
| Conversion order | Bottom-up (leaf modules first) | N/A |

## Migration Phases (summary)

See the Summary section at the end of `ts-transition.md` for the full milestone list. Brief overview:

1. **Infrastructure PR**: Wireit, Rollup, Terser configs + custom externs generator + Closure type-check wrapper
2. **Phase 0 PRs**: Convert `goog.provide`/`goog.require` → `goog.module` + `goog.module.declareLegacyNamespace()` (keep JSDoc types, no TS yet; Closure still bundles)
3. **Phase 1 PR**: Convert `goog.module` → `import`/`export` (all files at once, scriptable) + switch bundler from Closure to Rollup+Terser; Closure becomes type-checker only
4. **Bundle size gate** (see below) — must pass before Batch 0
5. **Batch 0**: Shaka interface types (`externs/shaka/` → `lib/types/`) + platform `.d.ts` files (~21 files)
6. **Batches 1–25**: Source files converted to TS in dependency order (~299 files)
7. **Phase 3 — Library Cleanup PR**: Remove Closure from library build; demo still uses it
8. **Phase 4 — Demo TS Conversion**: Rewrite demo in TypeScript; Closure fully removed after this lands

## Hybrid Build During Transition

While files are being converted batch by batch:
- **Rollup** bundles everything (both TS-compiled `.js` output and unconverted Closure `.js` files)
- **Closure** is run in type-check-only mode across the JS/TS boundary — it does NOT produce output
- **Custom externs generator** (`scripts/generate-externs.js`) reads `.d.ts` files (tsc output) and generates Closure externs so Closure can type-check the remaining JS files against the already-converted TS modules
- Closure's JSDoc annotations in unconverted `.js` files are invisible to Rollup (Rollup is not type-aware)

## Externs / Types Strategy

**Browser/platform externs (43 files in `externs/*.js`):**
- Most map to TypeScript's built-in `lib.dom.d.ts`
- Some need `@types/*` packages from DefinitelyTyped
- A few need manual `.d.ts` files (device-specific APIs)

**Shaka interface types (`externs/shaka/`, 21 files):**
- These are not true externs — they define Shaka's own public API shapes
- Migrate to `lib/types/` as proper TypeScript interfaces

**UI interface types (`ui/externs/ui.js`, `ui/externs/watermark.js`):**
- Same pattern as `externs/shaka/` — not true externs, define UI public API shapes
- Migrate to `ui/types/` before converting any UI source files (i.e., as the first step of Batch 22)

## Wrapper Template Compatibility

`build/wrapper.template.js` wraps the compiled output in an IIFE that supports CommonJS, AMD, and `<script>`-tag usage. This **must be preserved** in the new Rollup build.

Implementation: configure Rollup to produce an IIFE bundle (or use a Rollup plugin / banner+footer) that replicates the same compatibility shim. The public API is exported at `innerGlobal.shaka` (or via `exports`/`define` for CommonJS/AMD). Do not break existing consumers.

## Bundle Size Gate

**When**: After the Phase 1 tooling switch (Rollup+Terser replaces Closure bundling), but **before** converting any source files to TypeScript (i.e., when 100% of source files are still JS).

**Why**: Closure's `ADVANCED_OPTIMIZATIONS` mode (whole-program DCE, inlining, renaming) may produce smaller bundles than Rollup+Terser. We need to measure the delta at the tooling boundary, isolated from any conversion work.

**Process**:
1. Build with old system → record bundle sizes
2. Apply Phase 1 tooling switch → build with Rollup+Terser → record bundle sizes
3. Compare; if growth is significant, **stop and discuss with the team** before proceeding
4. Team decides whether the size regression is tolerable or needs mitigation (e.g., more aggressive Terser config, manual tree-shaking hints)

## Demo App (`demo/`)

The demo app stays on Closure/JS through Phases 0–3 for two reasons:
1. Validates that the public API has not broken during the transition
2. Validates that `dist/shaka-player.ui.externs.js` is correct and usable by downstream Closure users

**Phase 4** converts the demo to TypeScript as a separate project with its own build. Key architectural decisions:
- Demo loads the library via `<script>` tag — no ES module imports of the library source
- Accesses `shaka.*` as a global namespace
- `dist/shaka-player.ui.d.ts` must include an ambient `declare global { namespace shaka { ... } }` declaration (generated automatically, not hand-written) so TypeScript understands the global `shaka.*` usage
- Demo `tsconfig.json` references `dist/shaka-player.ui.d.ts` via `"files"`, not via `"types"` or module imports

## Custom Externs Generator (`scripts/generate-externs.js`)

- ~300–500 lines of Node.js using the TypeScript compiler API
- **Input**: `.d.ts` output from `tsc`
- **Output**: `dist/shaka-player.ui.externs.js` — Closure extern declarations for the public API
- **Two roles**: (1) during transition, feeds Closure's type-check-only run so it can validate remaining JS files against converted TS modules; (2) permanently, ships as a build artifact for external projects that use Shaka with Closure Compiler
- Replaces tsickle (officially unsupported Nov 2022, frozen May 2024)

## Scripting Phase 0 (goog.module Conversion)

Phase 0 converts each file from `goog.provide`/`goog.require` to `goog.module`
+ `goog.module.declareLegacyNamespace()`. This is mechanical and scriptable.

### Key constraints

- **Cannot mix ES `import` with `goog.provide`/`goog.require`** — incompatible
  module systems. The `goog.module` intermediate step is mandatory.
- **`goog.module.declareLegacyNamespace()` is the migration bridge** — it
  keeps `shaka.X.Y` in the global namespace so unconverted dependents compile
  and run unchanged. Keep it on every file until Phase 1.
- **Use named exports** (`exports = {ClassName}`) not default exports
  (`exports = ClassName`) — named exports translate cleanly to ES
  `export { ClassName }` in Phase 1.

### Per-file transformation

For a file being converted:
1. `goog.provide('shaka.X.Y')` → `goog.module('shaka.X.Y')` + `goog.module.declareLegacyNamespace()`
2. Each `goog.require('shaka.A.B')` (no return value currently) → `const {B} = goog.require('shaka.A.B')`
3. Each `goog.requireType('shaka.A.B')` → keep as-is (drop only in Phase 1)
4. `shaka.X.Y = class Y { ... }` → `class Y { ... }` + `exports = {Y}` at bottom
5. `shaka.X.Y = someValue` (non-class) → `const Y = someValue; exports = {Y}`
6. All `shaka.X.Y.method(...)` usages within the file body → `Y.method(...)`
7. Static properties after the class: `shaka.X.Y.CONST = ...` → `Y.CONST = ...`
8. Inner enum objects: `shaka.X.Y.EnumName = {...}` → `Y.EnumName = {...}`

For a file whose dependency was just converted (update its require site):
- No change needed immediately if the dependency used `declareLegacyNamespace()`.
  The `goog.require('shaka.A.B')` still works; `shaka.A.B` is still in global namespace.
- When this file is *itself* converted to `goog.module`, update the require to
  destructuring form: `const {B} = goog.require('shaka.A.B')`.

### Phase 0 script notes

A Node.js script can automate Phase 0. The per-file changes above are
straightforward regex + AST transforms. Key implementation points:

- **Regex approach works** for most files because the patterns are consistent:
  `goog.provide(...)`, `goog.require(...)`, `shaka.X.Y = class`, `shaka.X.Y.foo`
- **Insert `goog.module` + `declareLegacyNamespace` before first blank line**
  after the license header (or after the `goog.provide` location).
- **JSDoc type refs** like `{!shaka.A.B}` in `@param`/`@return` comments:
  leave them unchanged (Closure resolves them via the legacy namespace; updating
  them to `{!B}` would require a local `const B` to be in scope for Closure's
  type system, which it is after the `goog.require` destructuring).
- **Special case: `goog.asserts`** — `debug/asserts.js` provides `goog.asserts`
  (not a `shaka.*` namespace). ~100 files use `goog.requireType('goog.asserts')`.
  This stays as-is through Phase 0; handle separately.
- **`@export` annotation files** — these are part of the public API and need the
  global namespace machinery. They convert normally via `declareLegacyNamespace()`.
- **`debug/running_in_lab.js`** — not a class, just a boolean variable. Use
  `const RunningInLab = false; exports = {RunningInLab}`.
- **Enum-only files** — same pattern: `const EnumName = {...}; exports = {EnumName}`.

### Phase 1 script notes (goog.module → ES modules)

Run once after all files are `goog.module`. All-or-nothing (cannot mix).

- Remove `goog.module('shaka.X.Y')` line
- Remove `goog.module.declareLegacyNamespace()` line
- `const {Y} = goog.require('shaka.A.B')` → `import { Y } from './relative/b.js'`
  (compute relative path from the importing file to the source file)
- `goog.requireType(...)` → remove entirely
- `exports = {Y}` → remove; add `export` keyword on the class/const declaration
- `exports.Y = Y` → same: remove, add `export` keyword

After running this script, switch `rollup.config.js` from `format: 'iife'` with
Closure input to reading the ES module entry point directly.

## goog.asserts.assert Migration (Phase 2)

`goog.asserts.assert(expr)` is **not** like `console.assert`:
- **Removed at compile time** (with `goog.DEBUG=false`) — not present in production output
- Provides **Closure compile-time type narrowing** (acts as a type guard)

TypeScript replacements (case by case):
- `goog.asserts.assert(x != null)` before using `x` → `x!` (non-null assertion operator)
- `goog.asserts.assert(x instanceof Foo)` before using `x` as `Foo` → `(x as Foo)` or restructure with a real `if (!(x instanceof Foo)) throw` guard
- `goog.asserts.assert(false)` in unreachable branch → `throw new Error('unreachable')`
- Assert with genuine runtime intent → `if (!condition) throw new Error(...)`
- **Never** replace with `console.assert` — it stays in output, doesn't throw, and doesn't narrow types

## File Counts (approximate)

| Category | Files |
|----------|-------|
| Source files (lib/ + ui/) | ~299 |
| Test files | ~194 |
| Shaka interface externs | 21 |
| Browser/platform externs | 43 |
| Migration batches | 26 (Batch 0 – Batch 25) |
