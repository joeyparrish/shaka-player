# Shaka Player: Closure to TypeScript Transition Plan

This document outlines the complete transition plan for migrating Shaka Player
from Closure Compiler with `goog.provide`/`goog.require` to TypeScript with ES
modules and a modern Node.js-based build system.

## Table of Contents

1. [Goals and Constraints](#goals-and-constraints)
2. [Summary](#summary)
3. [Architecture Overview](#architecture-overview)
4. [Externs Strategy](#externs-strategy)
5. [Phase 0: goog.module Conversion](#phase-0-googmodule-conversion)
6. [Phase 1: ES Modules + Build System Modernization](#phase-1-es-modules--build-system-modernization)
7. [Phase 2: TypeScript Conversion](#phase-2-typescript-conversion)
8. [Phase 3: Cleanup and Finalization](#phase-3-cleanup-and-finalization)
9. [Phase 4: Demo App Migration](#phase-4-demo-app-migration)
10. [Migration Order by Batch](#migration-order-by-batch)
11. [Test Migration Strategy](#test-migration-strategy)
12. [Compatibility Layer](#compatibility-layer)
13. [Tooling Reference](#tooling-reference)

---

## Goals and Constraints

### Goals

- Convert all source files from Closure-annotated JavaScript to TypeScript
- Replace `goog.provide`/`goog.require` with ES modules (`import`/`export`)
- Eliminate Java dependency (Closure Compiler)
- Eliminate Python dependency (build scripts)
- Final build system relies only on Node.js and npm
- Maintain backward compatibility for `shaka.*` global namespace
- Support various bundle configs (dash-only, hls-only, ui, etc.)
- Support direct import into TypeScript projects
- Preserve or improve build performance with dependency tracking
- Convert the demo app to TypeScript (as a separate, later phase) with its own
  build, loading the player via `<script>` tag and referencing its `.d.ts` for
  type checking

### Constraints

- Incremental migration (mixed JS/TS codebase during transition)
- Existing tests must continue to pass throughout
- The demo app (`demo/`) remains in Closure/JS during the main library
  migration to serve as a validation tool, then is migrated to TypeScript
  separately in Phase 4

---

## Summary

This transition will be executed over multiple PRs, each containing one batch
of files plus their corresponding tests. The order is designed to minimize
dependencies—early batches have no internal Shaka dependencies, while later
batches build on converted modules.

**Key milestones:**

1. **Infrastructure PR**: Wireit, Rollup, Terser configs + custom externs
   generator + Closure type-check wrapper
2. **Phase 0 — goog.module PR(s)**: Convert `goog.provide`/`goog.require` →
   `goog.module` + `goog.module.declareLegacyNamespace()` (keep JSDoc types).
   Done bottom-up in batches. Closure continues bundling throughout; the
   `declareLegacyNamespace()` call preserves the `shaka.*` global namespace so
   not-yet-converted dependents continue to compile and run unmodified.
3. **Phase 1 — ES Modules + Bundler Switch PR**: Once all library files are
   `goog.module`, a single large but mechanical PR:
   - Removes `goog.module.declareLegacyNamespace()` from every file
   - Converts `goog.module`/`goog.require` → `import`/`export`
   - Switches bundler from Closure to Rollup+Terser; Closure becomes
     type-checker only
   - ⚠️  **Bundle size gate**: Measure and compare bundle sizes before
     proceeding. If Rollup+Terser produces significantly larger output than
     Closure's `ADVANCED_OPTIMIZATIONS`, stop and discuss with the team.
   - 📋 **Ongoing demo obligation begins**: The demo (`demo/`) must continue to
     compile and run after every subsequent PR through Phase 3, validating that
     the public API and generated Closure externs remain correct.
4. **Phase 2 — TypeScript Conversion** (26 batches, each a separate PR):
   - Batch 0: Shaka interface types (`externs/shaka/` → `lib/types/`) +
     platform `.d.ts` files ~21 files
   - Batches 1–4: Foundation (core types, utilities, parsing) ~58 files
   - Batches 5–10: Core systems (network, polyfills, devices, text, DRM,
     transmuxer) ~87 files
   - Batches 11–19: Feature modules (media, manifest parsers, ads, offline,
     cast) ~82 files
   - Batches 20–21: Player configuration and main Player class ~5 files
   - Batches 22–25: UI system ~46 files
5. **Phase 3 — Library Cleanup PR**: Remove Python build scripts, old externs,
   finalize package.json. Closure Compiler is removed from the *library* build,
   but the dependency remains in the project while the demo still uses it.
6. **Phase 4 — Demo TS Conversion**: Rewrite demo in TypeScript with a separate
   build; demo loads the player via `<script>` tag and references
   `dist/shaka-player.ui.d.ts` (including its global namespace declaration) for
   type checking. After this PR lands, Closure Compiler can be removed from the
   project entirely.

Total: ~299 library source files + ~194 test files + ~19 demo source files

---

## Architecture Overview

### Current State

<details>
<summary>Current State</summary>

```
┌─────────────────────────────────────────────────────────┐
│                    Source Files                         │
│  lib/ (239 JS)  │  ui/ (58 JS)  │  test/ (194 JS)       │
│  goog.provide/goog.require throughout                   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Python Build Scripts                       │
│  build/all.py → gendeps.py → build.py                   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│           Closure Compiler (Java)                       │
│  ADVANCED_OPTIMIZATIONS, type checking, bundling        │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Output                               │
│  dist/shaka-player.compiled.js (minified UMD bundle)    │
│  dist/shaka-player.compiled.d.ts (generated types)      │
└─────────────────────────────────────────────────────────┘
```

</details>

### Target State

<details>
<summary>Target State</summary>

```
┌─────────────────────────────────────────────────────────┐
│             Library Source Files                        │
│  lib/ (TS)  │  ui/ (TS)  │  test/ (TS)                  │
│  ES modules (import/export) throughout                  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              TypeScript Compiler (tsc)                  │
│  Type checking, emit ES modules to dist/esm/            │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Rollup (bundling + tree-shaking)           │
│  Multiple entry points for modular builds               │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Terser (minification)                      │
│  Produces .compiled.js with source maps                 │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│         Custom externs generator (Node.js)              │
│  Generates Closure externs from .d.ts files             │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    Output                                 │
│  dist/shaka-player.debug.js      (UMD, debug)             │
│  dist/shaka-player.compiled.js   (UMD, minified, no UI)   │
│  dist/shaka-player.ui.js         (UMD, minified, with UI) │
│  dist/shaka-player.esm.js        (ES module bundle)       │
│  dist/shaka-player.ui.d.ts       (TS declarations)        │
│  dist/shaka-player.ui.externs.js (Closure externs)        │
│  dist/shaka-player.dash.js       (DASH-only build)        │
│  dist/shaka-player.hls.js        (HLS-only build)         │
└───────────────────────────────────────────────────────────┘
```

</details>

### Demo App Target State (Phase 4)

The demo app has a separate target state. It is a TypeScript consumer of the
compiled library, not part of the library build itself:

<details>
<summary>Demo App Target State</summary>

```
┌─────────────────────────────────────────────────────────┐
│                 Library Build Output                    │
│  dist/shaka-player.ui.js      (loaded via <script> tag) │
│  dist/shaka-player.ui.d.ts   (types only, compile-time) │
└────────────────────────┬────────────────────────────────┘
                         │  references types
                         │  loads at runtime via <script>
                         ▼
┌─────────────────────────────────────────────────────────┐
│                Demo App Source (demo/ TS)               │
│  demo/ (TS)  │  own tsconfig.json                       │
│  No module imports of shaka — global shaka.* namespace  │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              TypeScript Compiler (tsc)                  │
│  Type-checks demo against dist/shaka-player.ui.d.ts     │
│  (which must declare the global shaka namespace)        │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│            Rollup + Terser (demo bundle)                │
│  dist/demo/demo.js                                      │
└─────────────────────────────────────────────────────────┘
```

</details>

---

## Externs Strategy

The current codebase has two categories of externs that require different
handling:

### Browser/Environment Externs (externs/*.js)

These files describe external APIs: browser APIs, third-party SDKs, and
platform-specific interfaces.

| Category | Files | TypeScript Handling |
|----------|-------|---------------------|
| Standard Browser APIs | `fetch.js`, `mediaerror.js`, `mediasession.js`, `pictureinpicture.js`, etc. | Built-in `lib.dom.d.ts` - no action needed |
| IndexedDB | `idb.js` | Built-in `lib.dom.d.ts` |
| Cast SDK | `cast-sdk-v2.js`, `cast-sdk-v3.js`, `cast-namespace.js` | Check DefinitelyTyped for `@anthropic/anthropic-ai-cast` or create `types/cast.d.ts` |
| IMA SDK | `ima.js` | Check DefinitelyTyped for `@types/google.ima` or create `types/ima.d.ts` |
| Platform APIs | `tizen.js`, `webos.js`, `xbox.js`, `playstation.js`, `hisense.js` | Create `types/platforms.d.ts` (niche, no community types) |
| LCEVC | `lcevc.js` | Create `types/lcevc.d.ts` |
| Legacy EME | `prefixed_eme.js`, `webkitmediakeys.js` | Create `types/legacy-eme.d.ts` |
| Other SDKs | `mediatailor.js`, `awesomplete.js`, `tippy.js`, etc. | Check DefinitelyTyped, create manual `.d.ts` if needed |

**Action items:**
1. Audit each extern file against TypeScript's built-in DOM types
2. Search DefinitelyTyped for available `@types/*` packages
3. Create `types/` directory for manual `.d.ts` files where needed
4. Platform-specific APIs (Tizen, WebOS, PlayStation, Xbox, Hisense) will require manual `.d.ts` files

### Shaka Interface Types (externs/shaka/*.js)

These files are **not true externs**. They define Shaka Player's own public
interface types that must remain stable for external consumers.

**These should become TypeScript interfaces in the source code.**

#### Conversion Pattern

**Before (Closure extern):**
<details>
<summary>Before: Closure extern</summary>

```javascript
// externs/shaka/net.js
/**
 * @typedef {{
 *   maxAttempts: number,
 *   baseDelay: number,
 *   backoffFactor: number,
 *   fuzzFactor: number,
 *   timeout: number,
 *   stallTimeout: number,
 *   connectionTimeout: number
 * }}
 * @exportDoc
 */
shaka.extern.RetryParameters;
```

</details>

**After (TypeScript interface):**
<details>
<summary>After: TypeScript interface</summary>

```typescript
// lib/types/net.ts
/**
 * Parameters for retry logic on network requests.
 */
export interface RetryParameters {
  /** Maximum number of retry attempts. */
  maxAttempts: number;
  /** Base delay in milliseconds between retries. */
  baseDelay: number;
  /** Multiplier for exponential backoff. */
  backoffFactor: number;
  /** Random factor to apply to delay (0-1). */
  fuzzFactor: number;
  /** Timeout in milliseconds for a single request. */
  timeout: number;
  /** Timeout for detecting stalls. */
  stallTimeout: number;
  /** Timeout for establishing connection. */
  connectionTimeout: number;
}
```

</details>

#### File Mapping: externs/shaka/ → lib/types/

| Extern File | TypeScript File | Key Types |
|-------------|-----------------|-----------|
| `net.js` | `lib/types/net.ts` | `RetryParameters`, `Request`, `Response`, `SchemePlugin`, `RequestFilter`, `ResponseFilter` |
| `manifest.js` | `lib/types/manifest.ts` | `Manifest`, `Variant`, `Stream`, `DrmInfo` |
| `player.js` | `lib/types/player.ts` | `PlayerConfiguration`, `TrackChoice`, `StateChange`, `Stats`, `BufferedInfo` |
| `error.js` | `lib/types/error.ts` | `Error`, `RestrictionInfo` |
| `abr_manager.js` | `lib/types/abr.ts` | `AbrManager`, `AbrConfiguration` |
| `text.js` | `lib/types/text.ts` | `TextParser`, `TextDisplayer`, `Cue` |
| `offline.js` | `lib/types/offline.ts` | `StoredContent`, `OfflineConfiguration` |
| `transmuxer.js` | `lib/types/transmuxer.ts` | `Transmuxer`, `TransmuxerPlugin` |
| `manifest_parser.js` | `lib/types/manifest_parser.ts` | `ManifestParser`, `ManifestParserFactory` |
| `ads.js` | `lib/types/ads.ts` | `AdManager`, `Ad`, `AdCuePoint` |
| Others | `lib/types/*.ts` | Corresponding interfaces |

### Closure Externs Generation (Long-term)

External projects using Closure Compiler may depend on Shaka's type
information. To support these users, **a custom Node.js script will generate
Closure externs from TypeScript declaration files** as a permanent part of the
build process.

#### Why not tsickle?

tsickle (Google's TS→Closure tool) was considered, but has been officially
unsupported since November 2022 and frozen since May 2024. The project
explicitly states it cannot support use outside the Google ecosystem. Rather
than depend on unmaintained tooling, we'll create a simple, maintainable custom
converter.

#### Custom Externs Generator

The generator (`scripts/generate-externs.js`) will:

1. Parse `.d.ts` files using the TypeScript Compiler API
2. Convert TypeScript constructs to Closure extern syntax
3. Output `dist/shaka-player.ui.externs.js`

**Supported conversions:**

| TypeScript | Closure Extern |
|------------|----------------|
| `export interface Foo { bar: string }` | `/** @typedef {{ bar: string }} */ shaka.extern.Foo;` |
| `export type Status = 'ok' \| 'error'` | `/** @typedef {string} */ shaka.extern.Status;` |
| `export class Player { load(uri: string): Promise<void> }` | `shaka.Player = class { /** @param {string} uri @return {!Promise<void>} */ load(uri) {} }` |
| `export enum TrackType { VIDEO, AUDIO }` | `/** @enum {string} */ shaka.TrackType = { VIDEO: 'VIDEO', AUDIO: 'AUDIO' }` |

**Example conversion:**

<details>
<summary>Externs generator: input/output example</summary>

```typescript
// Input: dist/shaka-player.ui.d.ts
export interface RetryParameters {
  maxAttempts: number;
  baseDelay: number;
  backoffFactor: number;
}

export class Player {
  constructor(video?: HTMLMediaElement);
  load(uri: string, startTime?: number): Promise<void>;
  destroy(): Promise<void>;
}
```

</details>

<details>
<summary>After: generated Closure externs</summary>

```javascript
// Output: dist/shaka-player.ui.externs.js
/** @externs */

/** @const */
var shaka = {};

/** @const */
shaka.extern = {};

/**
 * @typedef {{
 *   maxAttempts: number,
 *   baseDelay: number,
 *   backoffFactor: number
 * }}
 */
shaka.extern.RetryParameters;

shaka.Player = class {
  /** @param {HTMLMediaElement=} video */
  constructor(video) {}

  /**
   * @param {string} uri
   * @param {number=} startTime
   * @return {!Promise<void>}
   */
  load(uri, startTime) {}

  /** @return {!Promise<void>} */
  destroy() {}
};
```

</details>

The script will be ~300-500 lines and use only the TypeScript compiler API (no
external dependencies beyond `typescript` itself).

---

## Phase 0: goog.module Conversion

Convert `goog.provide`/`goog.require` to `goog.module` while keeping
JavaScript and JSDoc type annotations (not yet TypeScript, not yet ES modules).

**Why goog.module first?** You cannot mix ES `import` statements with
`goog.provide`/`goog.require` in the same file — they are incompatible module
systems. `goog.module` is Closure-native, so Closure continues bundling
unchanged. The key migration bridge is `goog.module.declareLegacyNamespace()`,
which re-exports the module's exports onto the global `shaka.*` namespace,
allowing unconverted dependents to keep using `goog.require` and `shaka.X.Y`
without modification.

### 0.1 Module Conversion Pattern

**Before (goog.provide):**

<details>
<summary>Before: goog.provide</summary>

```javascript
goog.provide('shaka.util.StringUtils');

goog.require('shaka.util.Error');
goog.require('shaka.util.BufferUtils');

shaka.util.StringUtils = class {
  static toUTF8(data) {
    // ...
  }
};
```

</details>

**After (goog.module):**

<details>
<summary>After: goog.module</summary>

```javascript
goog.module('shaka.util.StringUtils');
goog.module.declareLegacyNamespace();

const {ShakaError} = goog.require('shaka.util.Error');
const {BufferUtils} = goog.require('shaka.util.BufferUtils');

class StringUtils {
  static toUTF8(data) {
    // ...
  }
}

exports = {StringUtils};
```

</details>

Key mechanical changes per file:
- `goog.provide('shaka.X.Y')` → `goog.module('shaka.X.Y')` + `goog.module.declareLegacyNamespace()`
- `goog.require('shaka.A.B')` (no return value used) → `const {B} = goog.require('shaka.A.B')` (destructured)
- `goog.requireType('shaka.A.B')` → keep as-is (still needed for Closure type-checking in JS mode)
- `shaka.X.Y = class { ... }` → `class Y { ... }` + `exports = {Y}` at the bottom
- All `shaka.X.Y.method(...)` within the file body → `Y.method(...)`
- For static properties defined after the class body: `shaka.X.Y.CONST = ...` → `Y.CONST = ...`
- Inner enum objects: `shaka.X.Y.EnumName = {...}` → `Y.EnumName = {...}` (after the class)
- Non-class exports (variables, enums): `shaka.X.Y = value` → `const Y = value; exports = {Y}`

**On `declareLegacyNamespace()`:** Every converted file keeps this call until
Phase 1. It costs nothing at runtime (it's compiled away) and ensures existing
unconverted dependents see no change. Remove it only during the Phase 1
goog.module → ES module conversion.

### 0.2 Naming Conventions

| Closure Name | goog.module export | File Name |
|---|---|---|
| `shaka.Player` | `exports = {Player}` | `lib/player.js` |
| `shaka.util.Error` | `exports = {ShakaError}` | `lib/util/error.js` |
| `shaka.util.StringUtils` | `exports = {StringUtils}` | `lib/util/string_utils.js` |
| `shaka.media.StreamingEngine` | `exports = {StreamingEngine}` | `lib/media/streaming_engine.js` |

Note: `shaka.util.Error` becomes `ShakaError` to avoid collision with the built-in `Error` class.

Use `exports = {Name}` (named exports) rather than `exports = Name` (default
export). Named exports translate directly to ES `export { Name }` in Phase 1
and allow destructuring at require sites: `const {ShakaError} = goog.require(...)`.

### 0.3 Handling Circular Dependencies

The current codebase has some circular dependencies managed by Closure's lazy
loading. These remain deferred to Phase 1 (ES modules), where strategies are:

1. **Restructure**: Move shared code to a common module
2. **Late binding**: Use function-level dynamic imports for unavoidable cycles
3. **Barrel files**: Re-export from index files to break cycles

---

## Phase 1: ES Modules + Build System Modernization

This phase is triggered once every library source file has been converted to
`goog.module` in Phase 0. It converts the entire codebase from `goog.module`
to ES `import`/`export` in one large but fully mechanical PR, and simultaneously
switches the bundler from Closure to Rollup+Terser.

**Why one large PR?** You cannot have a file with ES `import` statements that
also depends on a file still using `goog.module`/`goog.require` — there is no
bridge in that direction. Once the first file becomes an ES module its
dependents must also be ES modules. The only viable approach is converting
everything at once. Fortunately, after Phase 0 the transformation is entirely
mechanical (scriptable) and straightforward to review.

### 1.0 goog.module → ES Module Conversion Pattern

**Before (goog.module after Phase 0):**

<details>
<summary>Before: goog.module</summary>

```javascript
goog.module('shaka.util.StringUtils');
goog.module.declareLegacyNamespace();

const {ShakaError} = goog.require('shaka.util.Error');
const {BufferUtils} = goog.require('shaka.util.BufferUtils');

class StringUtils {
  static toUTF8(data) {
    // ...
  }
}

exports = {StringUtils};
```

</details>

**After (ES module):**

<details>
<summary>After: ES module</summary>

```javascript
import { ShakaError } from './error.js';
import { BufferUtils } from './buffer_utils.js';

export class StringUtils {
  static toUTF8(data) {
    // ...
  }
}
```

</details>

Key mechanical changes per file:
- Remove `goog.module('shaka.X.Y')` and `goog.module.declareLegacyNamespace()`
- `const {Y} = goog.require('shaka.A.B')` → `import { Y } from './relative/path.js'`
- `goog.requireType('shaka.A.B')` → remove (types come from the import)
- `exports = {Y}` → remove (replace with `export` keyword on the class/const declaration)
- `export class Y` (inline on the class declaration)

This transformation is entirely scriptable. Run it once on all ~295 files.

### 1.1 New Dependencies

Add to `package.json`:

<details>
<summary>devDependencies</summary>

```json
{
  "devDependencies": {
    "typescript": "^5.3.0",
    "rollup": "^4.9.0",
    "@rollup/plugin-node-resolve": "^15.2.0",
    "@rollup/plugin-typescript": "^11.1.0",
    "terser": "^5.27.0",
    "wireit": "^0.14.0"
  }
}
```

</details>

### 1.2 Wireit Configuration

<details>
<summary>Wireit configuration</summary>

```json
{
  "scripts": {
    "clean": "rm -rf dist/",
    "build": "wireit",
    "build:esm": "wireit",
    "build:externs": "wireit",
    "build:full": "wireit",
    "build:full:debug": "wireit",
    "build:dash": "wireit",
    "build:dash:debug": "wireit",
    "build:hls": "wireit",
    "build:hls:debug": "wireit",
    "build:ui": "wireit",
    "build:all": "wireit",
    "test": "wireit",
    "lint": "wireit",
    "watch": "tsc --project tsconfig.build.json --watch"
  },
  "wireit": {
    "build:esm": {
      "command": "tsc --project tsconfig.build.json",
      "files": [
        "lib/**/*.ts",
        "ui/**/*.ts",
        "tsconfig.build.json",
        "tsconfig.json"
      ],
      "output": ["dist/esm/**", "dist/.tsbuildinfo"]
    },
    "build:externs": {
      "command": "node scripts/generate-externs.js",
      "dependencies": ["build:esm"],
      "files": ["dist/shaka-player.ui.d.ts", "scripts/generate-externs.js"],
      "output": ["dist/shaka-player.ui.externs.js"]
    },
    "build:full:debug": {
      "command": "rollup -c --environment BUILD:full",
      "dependencies": ["build:esm"],
      "files": ["dist/esm/**", "rollup.config.js"],
      "output": ["dist/shaka-player.debug.js", "dist/shaka-player.debug.js.map"]
    },
    "build:full": {
      "command": "terser dist/shaka-player.debug.js -o dist/shaka-player.compiled.js --source-map \"content='dist/shaka-player.debug.js.map',url='shaka-player.compiled.js.map'\" -c -m",
      "dependencies": ["build:full:debug"],
      "files": ["dist/shaka-player.debug.js", "dist/shaka-player.debug.js.map"],
      "output": ["dist/shaka-player.compiled.js", "dist/shaka-player.compiled.js.map"]
    },
    "build:dash:debug": {
      "command": "rollup -c --environment BUILD:dash",
      "dependencies": ["build:esm"],
      "files": ["dist/esm/**", "rollup.config.js"],
      "output": ["dist/shaka-player.dash.debug.js"]
    },
    "build:dash": {
      "command": "terser dist/shaka-player.dash.debug.js -o dist/shaka-player.dash.js -c -m",
      "dependencies": ["build:dash:debug"],
      "output": ["dist/shaka-player.dash.js"]
    },
    "build:hls:debug": {
      "command": "rollup -c --environment BUILD:hls",
      "dependencies": ["build:esm"],
      "files": ["dist/esm/**", "rollup.config.js"],
      "output": ["dist/shaka-player.hls.debug.js"]
    },
    "build:hls": {
      "command": "terser dist/shaka-player.hls.debug.js -o dist/shaka-player.hls.js -c -m",
      "dependencies": ["build:hls:debug"],
      "output": ["dist/shaka-player.hls.js"]
    },
    "build:ui:debug": {
      "command": "rollup -c --environment BUILD:ui",
      "dependencies": ["build:esm"],
      "files": ["dist/esm/**", "rollup.config.js"],
      "output": ["dist/shaka-player.ui.debug.js"]
    },
    "build:ui": {
      "command": "terser dist/shaka-player.ui.debug.js -o dist/shaka-player.ui.js -c -m",
      "dependencies": ["build:ui:debug"],
      "output": ["dist/shaka-player.ui.js"]
    },
    "build": {
      "dependencies": ["build:full", "build:externs"]
    },
    "build:all": {
      "dependencies": ["build:full", "build:dash", "build:hls", "build:ui", "build:externs"]
    },
    "lint": {
      "command": "eslint lib/ ui/ test/",
      "files": ["lib/**/*.ts", "ui/**/*.ts", "test/**/*.ts", ".eslintrc.*"],
      "output": []
    },
    "test": {
      "command": "karma start --single-run",
      "dependencies": ["build:full:debug"],
      "files": ["test/**/*.ts", "karma.conf.js"],
      "output": []
    }
  }
}
```

</details>

### 1.3 TypeScript Configuration

**tsconfig.json** (base):

<details>
<summary>tsconfig.json</summary>

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["lib/**/*", "ui/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

</details>

**tsconfig.build.json** (for building):

<details>
<summary>tsconfig.build.json</summary>

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist/esm",
    "incremental": true,
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  }
}
```

</details>

### 1.4 Rollup Configuration

**rollup.config.js**:

<details>
<summary>rollup.config.js</summary>

```javascript
import resolve from '@rollup/plugin-node-resolve';
import { defineConfig } from 'rollup';

const build = process.env.BUILD || 'full';

const configs = {
  full: {
    input: 'dist/esm/lib/player.js',
    output: 'dist/shaka-player.js',
  },
  dash: {
    input: 'dist/esm/lib/player_dash.js',
    output: 'dist/shaka-player.dash.js',
  },
  hls: {
    input: 'dist/esm/lib/player_hls.js',
    output: 'dist/shaka-player.hls.js',
  },
  ui: {
    input: 'dist/esm/ui/ui.js',
    output: 'dist/shaka-player.ui.js',
  },
};

const config = configs[build];

export default defineConfig({
  input: config.input,
  output: [
    {
      file: config.output,
      format: 'umd',
      name: 'shaka',
      sourcemap: true,
      globals: {},
    },
    {
      file: config.output.replace('.js', '.esm.js'),
      format: 'esm',
      sourcemap: true,
    },
  ],
  plugins: [resolve()],
});
```

</details>

### 1.5 Hybrid Build Strategy (During Transition)

During the transition, we use a hybrid build that maintains full type safety
across the entire codebase while avoiding Closure optimization concerns.

#### Build Flow

<details>
<summary>Build Flow</summary>

```
TS files ──→ tsc ──→ JS output ──────────────────────────────┐
              │                                              │
              └──→ .d.ts files ──→ externs generator         │
                                        │                    │
                                        ▼                    │
                                  Closure externs            │
                                        │                    │
                                        ▼                    │
Closure JS files + externs ──→ Closure Compiler ──→ (type check only,
                                        │              discard output)
                                        │                    │
Closure JS files (original) ────────────┼────────────────────┤
                                                             │
                                                             ▼
                                                      Rollup + Terser
                                                             │
                                                             ▼
                                                         bundle.js
```

</details>

#### Key principles

1. **Closure Compiler is type-checker only**: Closure validates type safety but
   does not bundle or optimize. Its output is discarded.

2. **Full cross-boundary type checking**: Closure sees the entire project—its
   own JS files plus externs generated from the TS `.d.ts` files. When Closure
   code calls a TS function, Closure verifies the types match.

3. **Rollup handles all bundling**: Both tsc's JS output and the original
   Closure JS files (with JSDoc comments intact, but ignored) go to Rollup for
   bundling and tree-shaking.

4. **Terser handles minification**: No reliance on Closure's
   `ADVANCED_OPTIMIZATIONS`.

#### Why this approach?

- **No optimization concerns from externs**: Since Closure isn't optimizing,
  externs don't prevent property renaming or inlining. They exist purely for
  type-checking.

- **Early validation of final toolchain**: Rollup+Terser handles bundling from
  day one, so any optimization differences from Closure are visible
  immediately—before TS conversion adds complexity.

- **Full type safety throughout**: At every stage of migration, the entire
  codebase is type-checked. tsc validates TS files, Closure validates JS files
  and the boundary between them.

- **Clean separation of concerns**: Closure = type checking, Rollup = bundling,
  Terser = minification. Each tool does one job.

#### Wireit configuration (during transition)

<details>
<summary>Wireit configuration (during transition)</summary>

```json
{
  "wireit": {
    "build:ts": {
      "command": "tsc --project tsconfig.build.json",
      "files": ["lib/**/*.ts", "ui/**/*.ts", "tsconfig.build.json"],
      "output": ["dist/esm/**", "dist/.tsbuildinfo"]
    },
    "build:externs": {
      "command": "node scripts/generate-externs.js",
      "dependencies": ["build:ts"],
      "files": ["dist/esm/**/*.d.ts", "scripts/generate-externs.js"],
      "output": ["dist/shaka-player.ui.externs.js"]
    },
    "typecheck:closure": {
      "command": "node scripts/closure-typecheck.js",
      "dependencies": ["build:externs"],
      "files": ["lib/**/*.js", "ui/**/*.js", "dist/shaka-player.ui.externs.js"],
      "output": []
    },
    "build:bundle": {
      "command": "rollup -c",
      "dependencies": ["build:ts", "typecheck:closure"],
      "files": ["dist/esm/**/*.js", "lib/**/*.js", "ui/**/*.js", "rollup.config.js"],
      "output": ["dist/shaka-player.debug.js", "dist/shaka-player.debug.js.map"]
    },
    "build:minify": {
      "command": "terser dist/shaka-player.debug.js -o dist/shaka-player.compiled.js --source-map \"content='dist/shaka-player.debug.js.map',url='shaka-player.compiled.js.map'\" -c -m",
      "dependencies": ["build:bundle"],
      "files": ["dist/shaka-player.debug.js"],
      "output": ["dist/shaka-player.compiled.js", "dist/shaka-player.compiled.js.map"]
    },
    "build": {
      "dependencies": ["build:minify", "build:externs"]
    }
  }
}
```

</details>

Note: `typecheck:closure` runs Closure Compiler with `--checks_only` flag (or
equivalent). The `scripts/closure-typecheck.js` wrapper handles invoking the
compiler and reporting errors without producing output.

#### Validating the approach

Before starting the transition, run these experiments:

**Experiment 1: Measure Rollup+Terser vs Closure optimization**

<details>
<summary>Experiment 1: Measure Rollup+Terser vs Closure optimization</summary>

```bash
# Current Closure ADVANCED bundle size
python build/build.py
ls -la dist/shaka-player.compiled.js  # baseline

# Build with Closure WHITESPACE_ONLY, then minify with Terser
java -jar closure-compiler.jar \
  --compilation_level=WHITESPACE_ONLY \
  --js='lib/**.js' --js='ui/**.js' \
  --js_output_file=dist/shaka-unoptimized.js

npx terser dist/shaka-unoptimized.js -o dist/shaka-terser.js -c -m

ls -la dist/shaka-terser.js  # compare to baseline
```

</details>

This reveals the optimization cost of switching away from Closure
`ADVANCED_OPTIMIZATIONS` before any other changes.

**Experiment 2: Validate Rollup config and bundle output**

There is no incremental subgraph test possible for ES modules: a `goog.module`
file has no way to import from an ES module file, so converting any subset
leaves those files unreachable by the rest of the codebase. Phase 1 must
convert all files at once.

Instead, validate the Rollup pipeline independently of the module conversion:
- Write a minimal synthetic entry point (a handful of ES module `.js` files
  that mirror Shaka's structure) outside `lib/`
- Run Rollup on it with the planned config (IIFE wrapper, Terser, sourcemaps)
- Verify output structure, source maps, and wrapper template compatibility

The real validation of Phase 1 happens by doing Phase 1 on a branch: run the
conversion script, bundle with Rollup, run the test suite, measure bundle size.
There is no lower-risk rehearsal available.

---

## Phase 2: TypeScript Conversion

### 2.1 Conversion Pattern

**Before (ES Module JS):**

<details>
<summary>Before: ES module JS</summary>

```javascript
import { ShakaError } from './error.js';

export class StringUtils {
  /**
   * @param {BufferSource} data
   * @return {string}
   */
  static toUTF8(data) {
    // ...
  }
}
```

</details>

**After (TypeScript):**

<details>
<summary>After: TypeScript</summary>

```typescript
import { ShakaError } from './error';

export class StringUtils {
  static toUTF8(data: BufferSource): string {
    // ...
  }
}
```

</details>

### 2.2 Type Definition Strategy

1. **Preserve existing JSDoc types**: Use as reference when adding TS types
2. **Create shared type files**: `lib/types/` for interfaces and type aliases
3. **Extern types**: Convert `externs/*.js` to `types/*.d.ts`

**Example types file** (`lib/types/manifest.ts`):

<details>
<summary>Example: Manifest interface</summary>

```typescript
export interface Manifest {
  presentationTimeline: PresentationTimeline;
  variants: Variant[];
  textStreams: Stream[];
  imageStreams: Stream[];
  offlineSessionIds: string[];
  minBufferTime: number;
  sequenceMode: boolean;
  ignoreManifestTimestampsInSegmentsMode: boolean;
  type: string;
  serviceDescription: ServiceDescription | null;
  nextUrl: string | null;
  periodCount: number;
  gapCount: number;
  isLowLatency: boolean;
}
```

</details>

### 2.3 Handling goog.asserts.assert

`goog.asserts.assert(expr)` does two things that have **no direct equivalent**
in TypeScript:

1. **Compile-time type narrowing**: Closure Compiler uses it as a type guard.
   After `goog.asserts.assert(x != null)`, Closure treats `x` as non-null in
   the remainder of that scope. Similarly, `goog.asserts.assert(x instanceof
   Foo)` narrows `x` to `Foo`.
2. **Compile-time removal**: The call is stripped entirely in compiled output
   (`--define=goog.DEBUG=false`). It does **not** behave like `console.assert`,
   which stays in the output and fires at runtime.

**Migration approach per call site:**

| Closure pattern | TypeScript replacement |
|---|---|
| `goog.asserts.assert(x != null); x.method()` | `x!.method()` — non-null assertion |
| `goog.asserts.assert(x != null); use(x)` | restructure with `if (x == null) throw` or use `x!` |
| `goog.asserts.assert(x instanceof Foo); x.fooMethod()` | TS narrows automatically after `if (!(x instanceof Foo)) throw`; or cast `(x as Foo).fooMethod()` |
| `goog.asserts.assert(false, 'unreachable')` | `throw new Error('unreachable')` (or leave as comment if the unreachability is guaranteed by types) |
| `goog.asserts.assert(condition)` used only for type narrowing, no runtime need | `condition!` or restructure; if the assert truly cannot fail, use `!` |
| `goog.asserts.assert(condition)` with real runtime intent | Replace with an `if (!condition) throw new Error(...)` guard |

**Key principle:** `goog.asserts.assert` is gone at runtime in production
Closure output. When converting to TypeScript:
- Use `!` (non-null assertion) when you are certain the value is non-null and
  the assert was purely for type narrowing.
- Use optional chaining `?.` when the code should gracefully handle null.
- Add a real `if (...) throw` guard when there is genuine runtime risk.

Do **not** replace `goog.asserts.assert` with `console.assert` — `console.assert`
is not removed at compile time and has different semantics (it logs, does not
throw, and does not narrow types).

---

## Phase 3: Cleanup and Finalization

### 3.1 Remove Deprecated Tooling

After all files are converted:

1. Delete `build/*.py` scripts
2. Remove Closure Compiler from the library build (it remains for the demo
   until Phase 4)
3. Remove any remaining Closure library shims (`goog.*` base polyfills)
4. Update CI/CD pipelines
5. Delete `externs/shaka/` directory (types now live in `lib/types/`)
6. Delete `externs/` directory (`.d.ts` replacements created in Batches 0–1)

**Note:** The custom externs generator (`scripts/generate-externs.js`) is
retained permanently to produce `dist/shaka-player.ui.externs.js` for external
Closure Compiler users.

### 3.2 Final package.json

<details>
<summary>Final package.json</summary>

```json
{
  "name": "shaka-player",
  "type": "module",
  "main": "dist/shaka-player.compiled.js",
  "module": "dist/shaka-player.esm.js",
  "types": "dist/shaka-player.ui.d.ts",
  "exports": {
    ".": {
      "import": "./dist/shaka-player.esm.js",
      "require": "./dist/shaka-player.compiled.js",
      "types": "./dist/shaka-player.ui.d.ts"
    },
    "./dash": {
      "import": "./dist/shaka-player.dash.esm.js",
      "require": "./dist/shaka-player.dash.js"
    },
    "./hls": {
      "import": "./dist/shaka-player.hls.esm.js",
      "require": "./dist/shaka-player.hls.js"
    },
    "./ui": {
      "import": "./dist/shaka-player.ui.esm.js",
      "require": "./dist/shaka-player.ui.js"
    },
    "./externs": "./dist/shaka-player.ui.externs.js"
  },
  "scripts": {
    "clean": "rm -rf dist/",
    "build": "wireit",
    "build:all": "wireit",
    "test": "wireit",
    "lint": "wireit",
    "watch": "tsc --watch"
  }
}
```

</details>

---

## Phase 4: Demo App Migration

The demo app (`demo/`) is kept in Closure/JS throughout the main library
migration (Phases 0–3) for two reasons:

1. **API validation**: The Closure-compiled demo exercises the library's full
   public API. If anything breaks in the transition, the demo will fail to
   compile or run.
2. **Externs validation**: The demo's Closure compilation depends on
   `dist/shaka-player.ui.externs.js` (generated by
   `scripts/generate-externs.js`).  If the generated externs are wrong or
   incomplete, the demo's type-checker will catch it.

Phase 4 begins only after the Phase 3 cleanup PR lands — i.e., the library
is fully TypeScript, the Closure compiler is gone from the library build, and
the generated `.d.ts` and `.externs.js` outputs are stable.

### 4.1 Demo Validation Period (during Phases 0–3)

The demo is **not modified** during the library migration. Its role is passive:
each time a library batch lands, the demo's existing Closure build must still
compile and pass manual smoke tests. This gives early warning of:

- Removed or renamed exports (missing from generated externs)
- Changed method signatures
- Missing types in generated externs

### 4.2 Demo TypeScript Conversion

The demo is rewritten in TypeScript as a separate project — a consumer of the
compiled API, not part of the library build. It loads the player via `<script>`
tag and accesses `shaka.*` as a global, with no ES module imports.

#### Prerequisite: global namespace declaration in `dist/shaka-player.ui.d.ts`

For the TypeScript compiler to understand `shaka.Player`, `shaka.util.Error`,
etc. in the demo's source, `dist/shaka-player.ui.d.ts` must declare the global
`shaka` namespace. This is done with an ambient declaration:

<details>
<summary>Ambient global namespace declaration</summary>

```typescript
// At the top of dist/shaka-player.ui.d.ts (or a separate dist/shaka-player.globals.d.ts)
declare global {
  namespace shaka {
    export class Player { /* ... */ }
    namespace util {
      export class Error { /* ... */ }
      // ...
    }
    // ... mirroring the full public API
  }
}
```

</details>

This declaration is generated automatically as part of the library build — it
is not written by hand. The externs generator or a separate script produces it
from the same type information used to generate `shaka-player.ui.externs.js`.

#### Demo `tsconfig.json`

The demo has its own `tsconfig.json` that references the library's `.d.ts` but
does not depend on the library's source:

<details>
<summary>Demo tsconfig.json</summary>

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist/demo",
    "types": []
  },
  "include": ["demo/**/*.ts"],
  "files": ["dist/shaka-player.ui.d.ts"]
}
```

</details>

#### Demo build in Wireit

<details>
<summary>Demo build in Wireit</summary>

```json
"build:demo": {
  "command": "rollup -c rollup.demo.config.mjs",
  "dependencies": ["build"],
  "files": ["demo/**/*.ts", "rollup.demo.config.mjs"],
  "output": ["dist/demo/**"]
}
```

</details>

The demo build depends on `build` (the library build) because it needs
`dist/shaka-player.ui.d.ts` and `dist/shaka-player.ui.js` to exist first.

#### Demo Rollup config (`rollup.demo.config.mjs`)

<details>
<summary>Demo Rollup config (`rollup.demo.config.mjs`)</summary>

```javascript
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'demo/app.ts',
  output: {
    file: 'dist/demo/demo.js',
    format: 'iife',
    name: 'shakaDemo',
  },
  plugins: [
    typescript({ tsconfig: './demo/tsconfig.json' }),
  ],
  // shaka is loaded via <script> tag, not bundled
  external: [],
};
```

</details>

The `shaka` global is available at runtime from the `<script>` tag and is
visible to TypeScript via the ambient declaration in the `.d.ts`.

#### HTML entry point

<details>
<summary>HTML entry point</summary>

```html
<!-- demo/index.html -->
<script src="../dist/shaka-player.ui.js"></script>
<script src="../dist/demo/demo.js"></script>
```

</details>


---

## Migration Order by Batch

Files are grouped into batches based on dependency analysis. Each batch should
be a separate PR for review. Migrate in order—later batches depend on earlier
ones.

### Batch 0: Shaka Interface Types (21 files)

**Convert `externs/shaka/*.js` → `lib/types/*.ts`**

These must be converted first as they define the public interfaces used
throughout the codebase. This batch creates the `lib/types/` directory.

<details>
<summary>Files</summary>

```
externs/shaka/net.js         → lib/types/net.ts
externs/shaka/manifest.js    → lib/types/manifest.ts
externs/shaka/player.js      → lib/types/player.ts
externs/shaka/error.js       → lib/types/error.ts
externs/shaka/abr_manager.js → lib/types/abr.ts
externs/shaka/text.js        → lib/types/text.ts
externs/shaka/offline.js     → lib/types/offline.ts
externs/shaka/transmuxer.js  → lib/types/transmuxer.ts
externs/shaka/manifest_parser.js → lib/types/manifest_parser.ts
externs/shaka/ads.js         → lib/types/ads.ts
externs/shaka/drm_info.js    → lib/types/drm.ts
externs/shaka/mp4_parser.js  → lib/types/mp4_parser.ts
externs/shaka/cea.js         → lib/types/cea.ts
externs/shaka/codecs.js      → lib/types/codecs.ts
externs/shaka/queue.js       → lib/types/queue.ts
externs/shaka/abortable.js   → lib/types/abortable.ts
externs/shaka/resolution.js  → lib/types/resolution.ts
externs/shaka/adaptation_set_criteria.js → lib/types/adaptation.ts
externs/shaka/offline_compat_v1.js → lib/types/offline_compat.ts
externs/shaka/offline_compat_v2.js → (merge into offline_compat.ts)
externs/shaka/namespace.js   → (not needed, namespace handled by exports)
```

</details>

Also create type declaration files for external APIs:
<details>
<summary>Files</summary>

```
types/platforms.d.ts   (Tizen, WebOS, PlayStation, Xbox, Hisense)
types/cast.d.ts        (Google Cast SDK)
types/ima.d.ts         (Google IMA SDK)
types/lcevc.d.ts       (LCEVC decoder)
types/legacy-eme.d.ts  (Prefixed EME, WebKit MediaKeys)
```

</details>

### Batch 1: Core Types and Interfaces (16 files)

Foundation types that everything else depends on. No dependencies on other
Shaka code.

<details>
<summary>Files</summary>

```
lib/util/i_destroyable.js
lib/util/i_releasable.js
lib/util/error.js
lib/debug/log.js
lib/debug/asserts.js
lib/debug/running_in_lab.js
lib/deprecate/version.js
lib/deprecate/enforcer.js
lib/deprecate/deprecate.js
lib/config/codec_switching_strategy.js
lib/config/cross_boundary_strategy.js
lib/config/position_area.js
lib/config/repeat_mode.js
lib/device/i_device.js
lib/util/timer.js
lib/util/delayed_tick.js
```

</details>

### Batch 2: Basic Utilities (21 files)

Low-level utilities with minimal dependencies. Only depend on Batch 1.

<details>
<summary>Files</summary>

```
lib/util/array_utils.js
lib/util/buffer_utils.js
lib/util/string_utils.js
lib/util/uint8array_utils.js
lib/util/map_utils.js
lib/util/object_utils.js
lib/util/number_utils.js
lib/util/time_utils.js
lib/util/iterables.js
lib/util/lazy.js
lib/util/multi_map.js
lib/util/public_promise.js
lib/util/abortable_operation.js
lib/util/destroyer.js
lib/util/mutex.js
lib/util/media_element_event.js
lib/util/content_steering_manager.js
lib/util/mime_utils.js
lib/util/language_utils.js
lib/util/manifest_parser_utils.js
lib/util/periods.js
```

</details>

### Batch 3: Event System and DOM Utilities (10 files)

Event handling and DOM manipulation utilities.

<details>
<summary>Files</summary>

```
lib/util/fake_event.js
lib/util/fake_event_target.js
lib/util/event_manager.js
lib/util/dom_utils.js
lib/util/media_ready_state_utils.js
lib/util/cmcd_manager.js
lib/util/cmsd_manager.js
lib/util/switch_history.js
lib/util/state_history.js
lib/util/stats.js
```

</details>

### Batch 4: Parsing Utilities (13 files)

Binary parsing, XML, and data format utilities.

<details>
<summary>Files</summary>

```
lib/util/data_view_reader.js
lib/util/data_view_writer.js
lib/util/mp4_parser.js
lib/util/mp4_box_parsers.js
lib/util/mp4_generator.js
lib/util/ts_parser.js
lib/util/pssh.js
lib/util/exp_golomb.js
lib/util/id3_utils.js
lib/util/text_parser.js
lib/util/functional.js
lib/util/stream_utils.js
lib/util/tXml.js
```

</details>

### Batch 5: Networking Layer (8 files)

Network request/response handling.

<details>
<summary>Files</summary>

```
lib/net/networking_engine.js
lib/net/networking_utils.js
lib/net/backoff.js
lib/net/http_fetch_plugin.js
lib/net/http_xhr_plugin.js
lib/net/http_plugin_utils.js
lib/net/data_uri_plugin.js
lib/util/operation_manager.js
```

</details>

### Batch 6: Polyfills (21 files)

Browser compatibility layer. These can be converted as a single unit.

<details>
<summary>Files</summary>

```
lib/polyfill/all.js
lib/polyfill/aria.js
lib/polyfill/fullscreen.js
lib/polyfill/map.js
lib/polyfill/media_capabilities.js
lib/polyfill/mediasource.js
lib/polyfill/orientation.js
lib/polyfill/pip_webkit.js
lib/polyfill/random_uuid.js
lib/polyfill/symbol.js
lib/polyfill/typed_array.js
lib/polyfill/videoplaybackquality.js
lib/polyfill/video_play_promise.js
lib/polyfill/vttcue.js
lib/polyfill/patchedmediakeys_apple.js
lib/polyfill/patchedmediakeys_cert.js
lib/polyfill/patchedmediakeys_webkit.js
lib/polyfill/eme_encryption_scheme.js
lib/polyfill/encryption_scheme_media_key_system_access.js
lib/polyfill/encryption_scheme_utils.js
lib/polyfill/mcap_encryption_scheme.js
```

</details>

### Batch 7: Device Detection (13 files)

Device capability detection.

<details>
<summary>Files</summary>

```
lib/device/device_factory.js
lib/device/abstract_device.js
lib/device/apple_browser.js
lib/device/chromecast.js
lib/device/default_browser.js
lib/device/hisense.js
lib/device/playstation.js
lib/device/tizen.js
lib/device/titan_os.js
lib/device/vizio.js
lib/device/webkit_stb.js
lib/device/webos.js
lib/device/xbox.js
```

</details>

### Batch 8: Text/Caption System (26 files)

Text track handling, CEA captions, and display.

<details>
<summary>Files</summary>

```
lib/text/cue.js
lib/text/cue_region.js
lib/text/native_text_displayer.js
lib/text/ui_text_displayer.js
lib/text/stub_text_displayer.js
lib/text/text_engine.js
lib/text/vtt_text_parser.js
lib/text/ttml_text_parser.js
lib/text/mp4_vtt_parser.js
lib/text/mp4_ttml_parser.js
lib/text/srt_text_parser.js
lib/text/speech_to_text.js
lib/text/text_utils.js
lib/text/web_vtt_generator.js
lib/cea/cea_decoder.js
lib/cea/cea608_memory.js
lib/cea/cea608_data_channel.js
lib/cea/cea708_service.js
lib/cea/cea708_window.js
lib/cea/dtvcc_packet_builder.js
lib/cea/cea_utils.js
lib/cea/dummy_caption_decoder.js
lib/cea/dummy_cea_parser.js
lib/cea/mp4_cea_parser.js
lib/cea/ts_cea_parser.js
lib/cea/sei_processor.js
```

</details>

### Batch 9: DRM System (4 files)

DRM engine and related utilities.

<details>
<summary>Files</summary>

```
lib/drm/drm_engine.js
lib/drm/drm_utils.js
lib/drm/fairplay.js
lib/drm/playready.js
```

</details>

### Batch 10: Transmuxer (14 files)

MPEG-TS to MP4 transmuxing.

<details>
<summary>Files</summary>

```
lib/transmuxer/transmuxer_engine.js
lib/transmuxer/ts_transmuxer.js
lib/transmuxer/aac_transmuxer.js
lib/transmuxer/ac3_transmuxer.js
lib/transmuxer/ec3_transmuxer.js
lib/transmuxer/mp3_transmuxer.js
lib/transmuxer/mpeg_audio.js
lib/transmuxer/mpeg_ts_transmuxer.js
lib/transmuxer/ac3.js
lib/transmuxer/ec3.js
lib/transmuxer/h264.js
lib/transmuxer/h265.js
lib/transmuxer/opus.js
lib/transmuxer/adts.js
```

</details>

### Batch 11: Media Engine Core (25 files)

Core media playback functionality.

<details>
<summary>Files</summary>

```
lib/media/segment_index.js
lib/media/segment_reference.js
lib/media/segment_prefetch.js
lib/media/segment_utils.js
lib/media/presentation_timeline.js
lib/media/gap_jumping_controller.js
lib/media/playhead.js
lib/media/playhead_observer.js
lib/media/play_rate_controller.js
lib/media/region_observer.js
lib/media/region_timeline.js
lib/media/buffering_observer.js
lib/media/video_wrapper.js
lib/media/closed_caption_parser.js
lib/media/media_source_capabilities.js
lib/media/media_source_engine.js
lib/media/streaming_engine.js
lib/media/preload_manager.js
lib/media/quality_observer.js
lib/media/manifest_filterer.js
lib/media/manifest_parser.js
lib/media/adaptation_set.js
lib/media/content_workarounds.js
lib/media/preference_based_criteria.js
lib/media/time_ranges_utils.js
```

</details>

### Batch 12: ABR (Adaptive Bitrate) (3 files)

<details>
<summary>Files</summary>

```
lib/abr/simple_abr_manager.js
lib/abr/ewma.js
lib/abr/ewma_bandwidth_estimator.js
```

</details>

### Batch 13: Manifest Parsers - DASH (9 files)

DASH manifest parsing.

<details>
<summary>Files</summary>

```
lib/dash/ebml_parser.js
lib/dash/dash_parser.js
lib/dash/segment_base.js
lib/dash/segment_list.js
lib/dash/segment_template.js
lib/dash/content_protection.js
lib/dash/mpd_utils.js
lib/dash/mp4_segment_index_parser.js
lib/dash/webm_segment_index_parser.js
```

</details>

### Batch 14: Manifest Parsers - HLS (4 files)

HLS manifest parsing.

<details>
<summary>Files</summary>

```
lib/hls/hls_parser.js
lib/hls/hls_utils.js
lib/hls/hls_classes.js
lib/hls/manifest_text_parser.js
```

</details>

### Batch 15: MOQT Streaming Format (MSF) (9 files)

<details>
<summary>Files</summary>

```
lib/msf/msf_utils.js
lib/msf/msf_classes.js
lib/msf/msf_parser.js
lib/msf/msf_control_stream.js
lib/msf/msf_tracks_manager.js
lib/msf/buffer_control_writer.js
lib/msf/msf_transport.js
lib/msf/msf_receiver.js
lib/msf/msf_sender.js
```

</details>

### Batch 16: Ads System (15 files)

Ad insertion support.

<details>
<summary>Files</summary>

```
lib/ads/abstract_ad.js
lib/ads/ad_manager.js
lib/ads/ad_utils.js
lib/ads/ads_stats.js
lib/ads/client_side_ad.js
lib/ads/client_side_ad_manager.js
lib/ads/interstitial_ad.js
lib/ads/interstitial_ad_manager.js
lib/ads/interstitial_static_ad.js
lib/ads/media_tailor_ad.js
lib/ads/media_tailor_ad_manager.js
lib/ads/server_side_ad.js
lib/ads/server_side_ad_manager.js
lib/ads/svta_ad.js
lib/ads/svta_ad_manager.js
```

</details>

### Batch 17: Offline Storage (20 files)

Offline playback support.

<details>
<summary>Files</summary>

```
lib/offline/storage.js
lib/offline/storage_muxer.js
lib/offline/download_manager.js
lib/offline/download_progress_estimator.js
lib/offline/download_info.js
lib/offline/stored_content_utils.js
lib/offline/manifest_converter.js
lib/offline/offline_manifest_parser.js
lib/offline/offline_scheme.js
lib/offline/offline_uri.js
lib/offline/session_deleter.js
lib/offline/stream_bandwidth_estimator.js
lib/offline/indexeddb/base_storage_cell.js
lib/offline/indexeddb/db_connection.js
lib/offline/indexeddb/db_operation.js
lib/offline/indexeddb/eme_session_storage_cell.js
lib/offline/indexeddb/storage_mechanism.js
lib/offline/indexeddb/v1_storage_cell.js
lib/offline/indexeddb/v2_storage_cell.js
lib/offline/indexeddb/v5_storage_cell.js
```

</details>

### Batch 18: Cast Support (4 files)

Google Cast integration.

<details>
<summary>Files</summary>

```
lib/cast/cast_proxy.js
lib/cast/cast_receiver.js
lib/cast/cast_sender.js
lib/cast/cast_utils.js
```

</details>

### Batch 19: LCEVC (1 file)

<details>
<summary>Files</summary>

```
lib/lcevc/lcevc_dec.js
```

</details>

### Batch 20: Player Configuration (2 files)

<details>
<summary>Files</summary>

```
lib/util/player_configuration.js
lib/util/config_utils.js
```

</details>

### Batch 21: Main Player Class (2 files)

The main entry point. Convert last as it depends on everything.

<details>
<summary>Files</summary>

```
lib/player.js
lib/queue/queue_manager.js
```

</details>

### Batch 22: UI - Core (13 files)

UI foundation classes. The `ui/less/*.less` files do not need TypeScript conversion — they continue to be compiled by the LESS build step as-is.

**Before converting any source files in this batch**, migrate `ui/externs/ui.js` and `ui/externs/watermark.js` to TypeScript interfaces (e.g., `ui/types/ui.ts`, `ui/types/watermark.ts`), following the same pattern as Batch 0. The UI source files depend on these types.

<details>
<summary>Files</summary>

```
ui/enums.js
ui/element.js
ui/range_element.js
ui/icon.js
ui/localization.js
ui/settings_menu.js
ui/ui_utils.js
ui/language_utils.js
ui/hidden_seek_button.js
ui/gl_matrix/matrix_4x4.js
ui/gl_matrix/matrix_quaternion.js
ui/less/containers.less
ui/less/controls.less
```

</details>

### Batch 23: UI - Controls (29 files)

UI control components.

<details>
<summary>Files</summary>

```
ui/controls.js
ui/seek_bar.js
ui/volume_bar.js
ui/mute_button.js
ui/fullscreen_button.js
ui/play_button.js
ui/playback_rate_selection.js
ui/presentation_time.js
ui/spacer.js
ui/overflow_menu.js
ui/fast_forward_button.js
ui/rewind_button.js
ui/pip_button.js
ui/cast_button.js
ui/remote_button.js
ui/loop_button.js
ui/context_menu.js
ui/vr_manager.js
ui/vr_utils.js
ui/vr_webgl.js
ui/content_title.js
ui/copy_video_frame_button.js
ui/hidden_fast_forward_button.js
ui/hidden_rewind_button.js
ui/recenter_vr.js
ui/save_video_frame_button.js
ui/skip_ad_button.js
ui/skip_next_button.js
ui/skip_previous_button.js
```

</details>

### Batch 24: UI - Selection Menus (14 files)

<details>
<summary>Files</summary>

```
ui/audio_language_selection.js
ui/resolution_selection.js
ui/text_selection.js
ui/chapter_selection.js
ui/statistics_button.js
ui/media_session.js
ui/icon_registry.js
ui/watermark.js
ui/ad_info.js
ui/ad_statistics_button.js
ui/text_position.js
ui/text_size.js
ui/toggle_stereoscopic.js
ui/video_type_selection.js
```

</details>

### Batch 25: UI - Main Entry Point (1 file)

<details>
<summary>Files</summary>

```
ui/ui.js
```

</details>

---

## Test Migration Strategy

Tests should be migrated in parallel with their corresponding source modules.
Each batch above should include the corresponding test files.

### Test File Mapping

| Source Batch | Test Files |
|--------------|------------|
| Batch 1 (Types/Interfaces) | `test/util/error_unit.js` |
| Batch 2 (Basic Utilities) | `test/util/string_utils_unit.js`, `test/util/buffer_utils_unit.js`, `test/util/array_utils_unit.js`, etc. |
| Batch 3 (Events/DOM) | `test/util/event_manager_unit.js`, `test/util/fake_event_target_unit.js` |
| Batch 4 (Parsing) | `test/util/mp4_parser_unit.js` |
| Batch 5 (Networking) | `test/net/networking_engine_unit.js`, `test/net/http_plugin_unit.js` |
| Batch 8 (Text) | `test/text/*.js` |
| Batch 9 (DRM) | `test/drm/drm_engine_unit.js`, `test/drm/drm_utils_unit.js` |
| Batch 11 (Media) | `test/media/*.js` |
| Batch 13 (DASH) | `test/dash/*.js`, `test/util/ebml_parser_unit.js` |
| Batch 14 (HLS) | `test/hls/*.js` |
| Batch 16 (Ads) | `test/ads/*.js` |
| Batch 17 (Offline) | `test/offline/*.js` |
| Batch 21 (Player) | `test/player_unit.js`, `test/player_integration.js` |
| Batch 22-25 (UI) | `test/ui/*.js` |

### Test Infrastructure Migration

Before migrating individual tests, update the test infrastructure:

1. **`test/test/boot.js`** - Test bootstrapping
2. **`test/test/util/*.js`** - Test utilities and helpers
3. **`test/test/externs/*.js`** - Test type definitions → `.d.ts`
4. **`karma.conf.js`** - Update for TypeScript support

**Updated karma.conf.js:**

<details>
<summary>karma.conf.js</summary>

```javascript
module.exports = function(config) {
  config.set({
    frameworks: ['jasmine'],
    files: [
      'dist/shaka-player.js',
      'test/**/*.ts'
    ],
    preprocessors: {
      'test/**/*.ts': ['typescript']
    },
    typescriptPreprocessor: {
      options: {
        project: 'tsconfig.test.json'
      }
    },
    // ...
  });
};
```

</details>

---

## Compatibility Layer

To maintain backward compatibility for users relying on `shaka.Player`,
`shaka.util.StringUtils`, etc., create a compatibility entry point.

### lib/shaka_exports.ts

<details>
<summary>lib/shaka_exports.ts</summary>

```typescript
// Re-export everything to global shaka namespace for backward compatibility
import { Player } from './player';
import { StringUtils } from './util/string_utils';
import { Error as ShakaError } from './util/error';
// ... all other exports

// Build the namespace object
export const shaka = {
  Player,
  util: {
    StringUtils,
    Error: ShakaError,
    // ...
  },
  media: {
    // ...
  },
  // ...
};

// Attach to window for script tag usage
if (typeof window !== 'undefined') {
  (window as any).shaka = shaka;
}

// Also export individual classes for ES module consumers
export { Player };
export { StringUtils };
export { ShakaError as Error };
// ...
```

</details>

This provides:
- `window.shaka.Player` for `<script>` tag users (backward compatible)
- `import { Player } from 'shaka-player'` for ES module users
- `import shaka from 'shaka-player'` for namespace import

---

## Tooling Reference

### Required npm Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.3.0 | Type checking and transpilation |
| `rollup` | ^4.9.0 | Bundling with tree-shaking |
| `@rollup/plugin-node-resolve` | ^15.2.0 | Node module resolution for Rollup |
| `@rollup/plugin-typescript` | ^11.1.0 | TypeScript support in Rollup |
| `terser` | ^5.27.0 | Minification |
| `wireit` | ^0.14.0 | Incremental builds with caching |
| `eslint` | ^8.56.0 | Linting |
| `@typescript-eslint/parser` | ^6.18.0 | ESLint TypeScript support |
| `@typescript-eslint/eslint-plugin` | ^6.18.0 | TypeScript-specific lint rules |

**Custom script:** `scripts/generate-externs.js` — generates
`dist/shaka-player.ui.externs.js` from `.d.ts` output; not an npm package.

### Closure Compiler Version for ES Modules

Key flags for ES module mode:

<details>
<summary>Compiler flags</summary>

```
--module_resolution=NODE
--language_in=ECMASCRIPT_NEXT
--language_out=ECMASCRIPT_2020
```

</details>

### Commands Reference

<details>
<summary>Commands Reference</summary>

```bash
# Development
npm run watch          # Watch mode, recompile on changes
npm run build          # Build default (full bundle + externs)
npm run build:all      # Build all variants + externs
npm run build:dash     # Build DASH-only variant
npm run build:hls      # Build HLS-only variant
npm run build:externs  # Generate Closure externs only

# Testing
npm test               # Run all tests
npm run lint           # Run linter

# Cleanup
npm run clean          # Remove dist/

# During transition (old system)
python build/all.py    # Full build with Closure
```

</details>
