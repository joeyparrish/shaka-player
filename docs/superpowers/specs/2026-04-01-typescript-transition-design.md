# Shaka Player TypeScript Transition Strategy

This document outlines a high-level, serial transition plan to move the Shaka Player codebase (~300 JS files) from a custom Closure Compiler build system using `goog.provide`/`goog.require` and JSDoc to a modern TypeScript architecture and build pipeline.

## Core Principles
*   **Incremental & Leaf-First:** The transition will be performed in waves, starting from utility modules (leaf nodes) and working up the dependency tree.
*   **Zero Downtime:** The library must remain functional, type-safe, and compatible at every stage. We cannot halt contributions for a "big bang" rewrite.
*   **API Stability:** The public API (including the `window.shaka` global namespace) must remain identical for downstream consumers.
*   **Testing as a Safety Net:** The existing integration tests and Closure-based Demo app will act as continuous validation of the build outputs and public API contracts throughout the transition.

## Architectural Approach: JSDoc as the Bridge
The most significant challenge is that Closure Compiler relies on JSDoc for `ADVANCED_OPTIMIZATIONS`, but standard TypeScript compilation (`.ts` -> `.js`) strips type information and does not emit JSDoc.

To maintain a type-safe, optimized project throughout the transition, we will adopt a **JSDoc-TS Strategy**:
1.  We will configure TypeScript (`tsc` with `allowJs: true` and `checkJs: true`) to natively read and type-check the existing `.js` files based purely on their JSDoc.
2.  We will migrate the module system incrementally to `goog.module` (Closure's modernized, locally-scoped module system). `goog.module` provides the exact same semantics as ES Modules (1:1 imports/exports) but allows bidirectional interop with legacy `goog.provide` files via `goog.module.declareLegacyNamespace()`.
3.  Once the entire codebase is structured as `goog.module`, we will automate a syntactic translation to standard ES Modules (`import`/`export`) and remove Closure Compiler from the production build.
4.  We will only rename files to `.ts` and convert JSDoc to inline TS syntax *after* the Closure Compiler dependency has been entirely removed from the production build.

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
3.  **Implement Modern Bundler**: Introduce Rollup/ESBuild to bundle the newly created ES Modules. Closure Compiler's dependency management is no longer required.
3.  **Replicate Build Variants**: Configure the bundler to output the exact same artifact family (`+@complete`, `-@ui`, etc.) and preserve the `window.shaka` global IIFE wrapper.
4.  **Validation**: Run the full suite of integration tests and Demo app checks against the *new* bundles to prove absolute API and runtime compatibility.

## Phase 3: Syntactic Sugar & Final Migration
**Goal:** Convert the `.js` + JSDoc codebase to native `.ts` syntax.

1.  **Prerequisite**: Closure Compiler is fully retired from the main library build. JSDoc is no longer strictly required for optimizations.
2.  **Rename and Convert**: Mechanically rename `.js` files to `.ts`. Automate the translation of JSDoc type annotations into inline TypeScript syntax. Because `tsc` was already checking the types in Phase 0, this should introduce zero logical regressions.
3.  **Convert Public API Source of Truth**: Translate `externs/shaka/*.js` into native TS interfaces (e.g., `src/api.ts`).
4.  **Update Tooling**: Ensure the custom `generateExterns.js` script now reads the TS interfaces to continue emitting Closure externs for downstream consumers (like the Demo app).

## Phase 4: Ecosystem Modernization
**Goal:** Clean up remaining technical debt and modernize dependent projects.

1.  **Migrate the Demo App**: Move the Demo app away from its Closure library dependencies to standard TS/ES Modules, leveraging the newly typed main library.
2.  **Documentation**: Update JSDoc generation tools to parse TypeScript AST instead of legacy comments.
3.  **Final Cleanup**: Remove any lingering Closure-specific polyfills or workarounds from the build scripts.
