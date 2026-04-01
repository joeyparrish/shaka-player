# TypeScript Transition: Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a TypeScript baseline by introducing a `tsconfig.json`, updating JSDoc to satisfy `tsc`, and replacing legacy Python and Babel scripts with TS-based AST scripts to generate `.d.ts` and Closure externs.

**Architecture:** We are adopting a JSDoc-TS strategy. `tsc` will run with `allowJs: true` and `checkJs: true` to type-check the existing `.js` files without altering runtime code. A new `build/generateExterns.js` (written using the TypeScript Compiler API) will replace the old Babel parser to generate Closure externs from JSDoc. `tsc` will replace `build/generateTsDefs.py` to natively generate `.d.ts` files.

**Tech Stack:** TypeScript Compiler (`tsc`), TypeScript Compiler API, JSDoc, Closure Compiler.

---

### Task 1: Introduce `tsconfig.json`

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.check.json` (for checking JS files)

- [ ] **Step 1: Write `tsconfig.json` for base configuration**

```json
{
  "compilerOptions": {
    "target": "es2021",
    "module": "esnext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": false,
    "skipLibCheck": true,
    "baseUrl": "./",
    "paths": {
      "shaka.*": ["lib/*", "ui/*", "externs/shaka/*"]
    }
  }
}
```

- [ ] **Step 2: Write `tsconfig.check.json` for checking JS files**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true
  },
  "include": [
    "lib/**/*.js",
    "ui/**/*.js",
    "externs/shaka/**/*.js"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "build"
  ]
}
```

- [ ] **Step 3: Run `tsc` to verify it finds errors**

Run: `npx tsc -p tsconfig.check.json`
Expected: FAIL with numerous JSDoc/type errors (this is expected and serves as the baseline).

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json tsconfig.check.json
git commit -m "build: Introduce base tsconfig for JSDoc type-checking"
```

### Task 2: Implement TS-based `generateExterns.js` (Part 1 - Setup)

**Files:**
- Modify: `package.json`
- Create: `build/generateExternsTs.js`

- [ ] **Step 1: Install TypeScript**

Run: `npm install --save-dev typescript @types/node`
Expected: PASS

- [ ] **Step 2: Create the script skeleton**

```javascript
// build/generateExternsTs.js
const ts = require('typescript');
const fs = require('fs');

function main(args) {
  console.log("TS-based externs generation placeholder");
}

main(process.argv.slice(2));
```

- [ ] **Step 3: Run script**

Run: `node build/generateExternsTs.js`
Expected: "TS-based externs generation placeholder"

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json build/generateExternsTs.js
git commit -m "build: Add skeleton for TS-based externs generation"
```

### Task 3: Implement TS-based `generateExterns.js` (Part 2 - AST Traversal)

**Files:**
- Modify: `build/generateExternsTs.js`

- [ ] **Step 1: Write the AST parsing logic**

Replace `build/generateExternsTs.js` content with logic to parse files using `ts.createSourceFile` and extract `goog.provide`, `goog.module`, `goog.require`, and JSDoc `@export` annotations.

```javascript
// build/generateExternsTs.js
const ts = require('typescript');
const fs = require('fs');

function isGoogProvideOrModule(node) {
  return ts.isExpressionStatement(node) &&
         ts.isCallExpression(node.expression) &&
         ts.isPropertyAccessExpression(node.expression.expression) &&
         node.expression.expression.expression.text === 'goog' &&
         (node.expression.expression.name.text === 'provide' || node.expression.expression.name.text === 'module');
}

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ESNext, true);
  
  const provides = [];
  const requires = [];
  
  ts.forEachChild(sourceFile, node => {
    if (isGoogProvideOrModule(node)) {
        provides.push(node.expression.arguments[0].text);
    }
  });
  
  return { provides, requires };
}

function main(args) {
  // Skeleton usage
  console.log(parseFile(args[0]));
}

main(process.argv.slice(2));
```

- [ ] **Step 2: Run script on a known file**

Run: `node build/generateExternsTs.js lib/player.js`
Expected: Output showing `{ provides: ['shaka.Player'], requires: [...] }` (or similar, depending on implementation details).

- [ ] **Step 3: Commit**

```bash
git add build/generateExternsTs.js
git commit -m "build: Add AST parsing to generateExternsTs.js"
```

### Task 4: Replace old `generateExterns.js`

**Files:**
- Delete: `build/generateExterns.js`
- Rename: `build/generateExternsTs.js` -> `build/generateExterns.js`
- Modify: `build/all.py` (or wherever it's called) to ensure it uses the new script.

*(Note: The full implementation of `generateExterns.js` is complex and will require a dedicated sub-plan or iterative refinement during execution. The tasks above establish the path).*

### Task 5: Configure `.d.ts` Generation

**Files:**
- Create: `tsconfig.dts.json`
- Modify: `build/build.py` (or appropriate build script) to remove `generateTsDefs.py` and call `tsc`.

- [ ] **Step 1: Write `tsconfig.dts.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist/types"
  },
  "include": [
    "lib/**/*.js",
    "ui/**/*.js",
    "externs/shaka/**/*.js"
  ]
}
```

- [ ] **Step 2: Run `tsc` to generate types**

Run: `npx tsc -p tsconfig.dts.json`
Expected: Output in `dist/types/`.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.dts.json
git commit -m "build: Configure tsc for .d.ts generation"
```

### Task 6: Iterative JSDoc Cleanup (Ongoing)

This task represents the bulk of the manual work in Phase 0. It involves running `tsc -p tsconfig.check.json` and fixing the reported errors in `.js` files until the build is green.

- [ ] **Step 1: Run Type Check**
Run: `npx tsc -p tsconfig.check.json`

- [ ] **Step 2: Fix Errors in a specific module/directory**
- [ ] **Step 3: Verify Fixes**
- [ ] **Step 4: Commit**

*(Repeat until `tsc -p tsconfig.check.json` exits with 0)*

---
