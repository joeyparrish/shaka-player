/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/**
 * @externs
 */


/**
 * @typedef {{
 *   hasAppRestrictions: boolean,
 *   missingKeys: !Array<string>,
 *   restrictedKeyStatuses: !Array<string>
 * }}
 *
 * @property {boolean} hasAppRestrictions
 *   Whether there are streams that are restricted due to app-provided
 *   restrictions.
 * @property {!Array<string>} missingKeys
 *   The key IDs that were missing.
 * @property {!Array<string>} restrictedKeyStatuses
 *   The restricted EME key statuses that the streams had.  For example,
 *   'output-restricted' would mean streams couldn't play due to restrictions
 *   on the output device (e.g. HDCP).
 * @exportDoc
 */
shaka.extern.RestrictionInfo;


/**
 * @interface
 * @exportDoc
 */
shaka.extern.Error = class {
  constructor() {
    /**
     * @type {shaka.extern.Error.Severity}
     * @exportDoc
     */
    this.severity;

    /**
     * @const {shaka.extern.Error.Category}
     * @exportDoc
     */
    this.category;

    /**
     * @const {shaka.extern.Error.Code}
     * @exportDoc
     */
    this.code;

    /**
     * @const {!Array<*>}
     * @exportDoc
     */
    this.data;

    /**
     * @type {boolean}
     * @exportDoc
     */
    this.handled;
  }
};


/**
 * Values must come from the shaka.util.Error.Severity runtime enum.
 *
 * TODO(TS): Restore as a literal union type when migrating to TypeScript.
 *
 * @typedef {number}
 */
shaka.extern.Error.Severity;


/**
 * Values must come from the shaka.util.Error.Category runtime enum.
 *
 * TODO(TS): Restore as a literal union type when migrating to TypeScript.
 *
 * @typedef {number}
 */
shaka.extern.Error.Category;


/**
 * Values must come from the shaka.util.Error.Code runtime enum.
 *
 * TODO(TS): Restore as a literal union type when migrating to TypeScript.
 *
 * @typedef {number}
 */
shaka.extern.Error.Code;
