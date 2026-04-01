# Shaka Player TypeScript Transition Strategy

This document outlines a high-level, serial transition plan to move the Shaka Player codebase (~300 JS files) from a custom Closure Compiler build system using `goog.provide`/`goog.require` and JSDoc to a modern TypeScript architecture and build pipeline.

## Core Principles
*   **Incremental & Leaf-First:** The transition will be performed in waves, starting from utility modules (leaf nodes) and working up the dependency tree.
*   **Zero Downtime:** The library must remain functional, type-safe, and compatible at every stage. We cannot halt contributions for a "big bang" rewrite.
*   **API Stability:** The public API (including the `window.shaka` global namespace) must remain identical for downstream consumers.
*   **Testing as a Safety Net:** The existing integration tests and Closure-based Demo app will act as continuous validation of the build outputs and public API contracts throughout the transition.

## Type Strictness Policy
*   **Immediate Strict Mode:** TypeScript's `"strict": true` compiler flag will be enabled immediately in Phase 0. Every existing JS file must be fully and strictly typed (no implicit `any`, strict null checks) against `tsc` before the transition begins in earnest.
*   **Banning 'any':** The use of the `any` type is strictly forbidden by default. Developers must strongly prefer the `unknown` type and employ proper type narrowing (e.g., type guard functions).
*   **Documented Exceptions:** If an `any` type is absolutely necessary (e.g., due to a mismatch between Closure's type system and TypeScript's), it must be accompanied by an inline `// eslint-disable-next-line` directive and an explicit comment justifying the workaround. This policy will be enforced via ESLint rules (`@typescript-eslint/no-explicit-any`).

## Architectural Approach: JSDoc as the Bridge
The most significant challenge is that Closure Compiler relies on JSDoc for `ADVANCED_OPTIMIZATIONS`, but standard TypeScript compilation (`.ts` -> `.js`) strips type information and does not emit JSDoc.

To maintain a type-safe, optimized project throughout the transition, we will adopt a **JSDoc-TS Strategy**:
1.  We will configure TypeScript (`tsc` with `allowJs: true` and `checkJs: true`) to natively read and type-check the existing `.js` files based purely on their JSDoc.
2.  We will migrate the module system incrementally to `goog.module` (Closure's modernized, locally-scoped module system). `goog.module` provides the exact same semantics as ES Modules (1:1 imports/exports) but allows bidirectional interop with legacy `goog.provide` files via `goog.module.declareLegacyNamespace()`.
3.  Once the entire codebase is structured as `goog.module`, we will automate a syntactic translation to standard ES Modules (`import`/`export`) and remove Closure Compiler from the production build.
4.  We will only rename files to `.ts` and convert JSDoc to inline TS syntax *after* the Closure Compiler dependency has been entirely removed from the production build.

## Developer Experience (DX) & CI Abstraction
To ease contributors into the new ecosystem and isolate CI from the underlying script changes, we will aggressively adopt `npm run` scripts as an abstraction layer:
1.  **Phase 0 NPM Cutover**: We will define comprehensive `npm run` scripts (e.g., `npm run build`, `npm run test`, `npm run lint`, `npm run check`) in `package.json`. These will initially wrap the legacy `python3 build/...` scripts alongside the new `tsc` and ESLint checks.
2.  **CI & Documentation**: All `.github/workflows/*.yaml` files and `AGENTS.md` instructions will be immediately updated to use these `npm run` commands in Phase 0.
3.  **Incremental Tutorials**: Tutorials (e.g., `docs/tutorials/plugins.md`) will be updated incrementally. In Phase 0, we will update references to point to `npm run` where appropriate. In Phase 2 (Bundler Swap), we will rewrite the specific tutorials that document legacy python build flags (`+@complete -@polyfill`) to reflect the new static entry point architecture.

## Phase 0: Tooling Alignment & Baselining
**Goal:** Introduce modern TypeScript tooling without altering runtime code, establishing a dual-checked baseline.

1.  **Introduce `tsconfig.json`**: Configure `tsc` to type-check the entire `lib/` and `ui/` directories using JSDoc.
2.  **JSDoc Cleanup**: Fix any discrepancies where `tsc` interprets JSDoc differently than Closure Compiler (e.g., standardizing `@record`, fixing loose typings). The goal is 100% strict `tsc` compliance.
3.  **Modernize Externs Generation (`build/generateExterns.js`)**: Rewrite the script that generates Closure externs from source. Replace the fragile `@babel/parser` implementation with a robust script using the TypeScript Compiler API. This script will read the JSDoc/AST and emit accurate Closure externs. *Validation: The Demo app must continue to build and run successfully using these generated externs.*
4.  **Replace `.d.ts` Generation**: Retire `build/generateTsDefs.py`. Configure `tsc` to emit high-quality `.d.ts` declaration files directly from the JSDoc.

## Phase 1: Module System Migration (`goog.module`)
**Goal:** Convert the internal dependency graph from `goog.provide` to `goog.module`.

1.  **Leaf-First Conversion**: Incrementally update files, replacing `goog.provide` with `goog.module('shaka...')` and `goog.module.declareLegacyNamespace()`. This scopes the file contents locally (like an ES Module) while allowing legacy `goog.provide` files to continue requiring them seamlessly. Files remain `.js` with JSDoc.
2.  **Test Alignment**: Update corresponding unit tests in tandem with their source files.
3.  **Continuous Validation**: We will rely on the CI pipeline (integration tests, Demo app build) to ensure the generated bundles remain structurally and behaviorally identical at every incremental step.
4.  **Externs & Public API**: The existing `externs/shaka/*.js` files remain the source of truth for the API. The TS-based `generateExterns.js` script must handle both legacy `goog.provide` and new `goog.module` declarations.

## Phase 2: ES Modules & Bundler Swap
**Goal:** Transition to standard ES Modules and replace Closure Compiler with a modern bundler (e.g., Rollup or ESBuild) for production builds.

1.  **Prerequisite**: All 300+ files must be fully converted to `goog.module`.
2.  **Automated ES Module Conversion**: Because `goog.module` semantics directly map to standard ES modules, perform an automated codebase-wide translation from `goog.module` to standard ES `import` and `export` statements.
3.  **Static Entry Points & Build Variants**: Because we lose `goog.module.declareLegacyNamespace()`, we must explicitly create top-level entry points. We will retire the `build/types/` custom config files. Instead, we will manually create and maintain a series of static entry points for each official variant (e.g., `src/entries/compiled.js`, `src/entries/ui.js`). Each entry point explicitly imports and re-exports only the modules and plugins required for that specific build variant.
4.  **Implement Modern Bundler & Build Flags**: Introduce Rollup/ESBuild. The bundler simply takes each static entry point file and bundles it into its respective artifact (`shaka-player.compiled.js`, `shaka-player.ui.js`, etc.), relying on natural ES module tree-shaking. The bundler must be configured with a replacement plugin (e.g., `@rollup/plugin-replace` or ESBuild's `define`) to inject the compile-time constants currently managed by Closure in `build/build.py`. These include `COMPILED`, `goog.DEBUG`, `goog.asserts.ENABLE_ASSERTS`, `shaka.log.MAX_LOG_LEVEL`, and `shaka.Player.version`. Because `shaka.Player` is the primary export, properties attached directly to it will not be tree-shaken.
5.  **Preserve the Global Namespace**: Configure the bundler to preserve the `window.shaka` global IIFE wrapper for generated artifacts. All existing build variants will continue to be generated unless explicitly sunset by the maintainers in the future.
6.  **Uncompiled Test Runner Updates**: The test runner (Karma) and `shaka-player.uncompiled.js` must be updated to natively load standard ES modules (`<script type="module">`) instead of relying on Closure's dependency loader.
7.  **Validation**: Run the full suite of integration tests and Demo app checks against the *new* bundles to prove absolute API and runtime compatibility.

## Phase 3: Syntactic Sugar & Final Migration
**Goal:** Convert the `.js` + JSDoc codebase to native `.ts` syntax.

1.  **Prerequisite**: Closure Compiler is fully retired from the main library build. JSDoc is no longer strictly required for optimizations.
2.  **Rename and Convert**: Mechanically rename `.js` files to `.ts`. Automate the translation of JSDoc type annotations into inline TypeScript syntax. Because `tsc` was already checking the types in Phase 0, this should introduce zero logical regressions.
3.  **Convert Public API Source of Truth**: Translate `externs/shaka/*.js` into native TS interfaces (e.g., `src/api.ts`).
4.  **Environmental Externs Replacement**: The browser/platform externs in `externs/*.js` (outside `externs/shaka/`) will be retired. Standard APIs will be covered by TypeScript's built-in `lib.dom.d.ts`. Any experimental or non-standard web APIs will be defined in a custom `global.d.ts` file.
5.  **Update Tooling**: Ensure the custom `generateExterns.js` script now reads the TS interfaces to continue emitting Closure externs for downstream consumers (like the Demo app).

## Phase 4: Ecosystem Modernization
**Goal:** Clean up remaining technical debt and modernize dependent projects.

1.  **Migrate the Demo App**: Move the Demo app away from its Closure library dependencies to standard TS/ES Modules, leveraging the newly typed main library.
2.  **Documentation Generator Swap**: Replace the unmaintained, custom fork of JSDoc with a modern, TypeScript-native documentation generator (like **TypeDoc**). This directly parses the TS AST and modern TS interfaces, producing cleaner API docs with less custom tooling overhead.
3.  **Final Cleanup**: Remove any lingering Closure-specific polyfills or workarounds from the build scripts.
