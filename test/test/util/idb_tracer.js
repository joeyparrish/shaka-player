/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// This file exists to patch the IndexedDB prototypes, so the usual bans on
// touching .prototype and on using non-arrow function expressions (which we
// need for a dynamic "this") do not apply here.
/* eslint-disable no-restricted-syntax */

/**
 * @fileoverview A tracing shim for IndexedDB.  This file replaces methods on
 * the IDB prototypes with wrappers, and builds trace records whose fields vary
 * by the operation being recorded, neither of which Closure can type.  The
 * file-level suppress unblocks its strict-property and unknown-type checks
 * across the whole file.
 *
 * @suppress {checkTypes|missingProperties|strictMissingProperties}
 */

/**
 * A diagnostic shim that wraps the IndexedDB API and records the sequence and
 * timing of every asynchronous operation.
 *
 * This exists to investigate a macOS-only failure in which every async IDB
 * request stops completing partway through the offline storage tests, and does
 * not recover until the browser is restarted.  Once an operation has been
 * outstanding for longer than the configured threshold, the tracer declares the
 * database wedged and dumps the trace to the console, where Karma forwards it
 * to the test runner's output.  The trace is written to the console rather than
 * to storage precisely because storage is the thing that has stopped working.
 *
 * The trace records metadata only -- store names, keys, byte counts, and the
 * shape of stored values -- never the stored bytes themselves.  Test media
 * segments are far too large to ship through a log, and the sizes are enough to
 * synthesize equivalent values when replaying the trace.
 *
 * Disabled unless test.py is given --idb-trace.
 */
shaka.test.IdbTracer = class {
  /**
   * Install the shim.  Safe to call more than once; later calls do nothing.
   *
   * @param {Object=} config
   */
  static install(config) {
    const T = shaka.test.IdbTracer;
    if (T.installed_) {
      return;
    }
    if (!window.indexedDB || !window.IDBRequest) {
      return;
    }
    T.installed_ = true;

    T.config_ = {
      // How long an operation may be outstanding before we call it wedged.
      // Healthy operations take milliseconds, and a genuine wedge never
      // completes at all, so this only needs to be clearly abnormal.  Keep it
      // well above the slowest legitimate write on a loaded CI runner, or a
      // slow segment store will be misreported as a hang.
      wedgeMs: 15000,
      // Cap on retained records, so a long run cannot exhaust memory.
      maxRecords: 50000,
      // Records per console line when dumping.
      chunkSize: 50,
    };
    for (const key in config || {}) {
      T.config_[key] = config[key];
    }

    T.t0_ = performance.now();
    T.installFactoryHooks_();
    T.installDatabaseHooks_();
    T.installStoreHooks_();
    T.installIndexHooks_();
    T.installCursorHooks_();
    T.installTransactionHooks_();
    T.installSpecReporter_();

    T.watchdog_ = setInterval(() => T.checkForWedge_(), 500);

    // Sequence numbers restart at 1 in every browser session, so a log that
    // holds more than one run (test.py --runs) would have colliding sequence
    // numbers.  Tag each dump with a session id to keep the runs apart.
    T.session_ = Math.random().toString(36).slice(2, 10);

    console.log('[idb-trace] Installed IndexedDB tracer. session=' +
                T.session_);
  }

  /**
   * Dump the trace to the console.
   *
   * @param {string} reason
   */
  static dump(reason) {
    const T = shaka.test.IdbTracer;
    const pending = Array.from(T.pending_.values());

    // Emit a compact summary first.  If the full trace is truncated by the log
    // pipeline, this is the part we most need to survive.
    const summary = {
      reason: reason,
      spec: T.currentSpec_,
      totalRecords: T.records_.length,
      droppedRecords: T.dropped_,
      pendingCount: pending.length,
      pending: pending.slice(0, 20),
      tail: T.records_.slice(-50),
    };
    console.log('[idb-trace] SUMMARY ' + T.session_ + ' ' +
                T.stringify_(summary));

    const total = Math.ceil(T.records_.length / T.config_.chunkSize);
    console.log('[idb-trace] BEGIN session=' + T.session_ + ' chunks=' + total +
                ' records=' + T.records_.length);
    let index = 0;
    for (let i = 0; i < T.records_.length; i += T.config_.chunkSize) {
      const chunk = T.records_.slice(i, i + T.config_.chunkSize);
      index++;
      console.log('[idb-trace] CHUNK ' + T.session_ + ' ' + index + '/' +
                  total + ' ' + T.stringify_(chunk));
    }
    console.log('[idb-trace] END');
  }

  /**
   * @return {boolean} True if the tracer has detected a wedged database.
   */
  static isWedged() {
    return shaka.test.IdbTracer.wedged_;
  }

  /**
   * Look for any operation that has been outstanding long enough to count as a
   * hang.  Dumps the trace the first time one is found.
   *
   * @private
   */
  static checkForWedge_() {
    const T = shaka.test.IdbTracer;
    if (T.wedged_) {
      return;
    }
    const now = T.now_();
    for (const rec of T.pending_.values()) {
      const age = now - rec.t;
      if (age > T.config_.wedgeMs) {
        T.wedged_ = true;
        console.error('[idb-trace] WEDGE DETECTED: ' + rec.op +
                      ' (seq ' + rec.seq + ') outstanding for ' +
                      Math.round(age) + 'ms');
        T.dump('wedge: ' + rec.op + ' seq=' + rec.seq);
        return;
      }
    }
  }

  /**
   * @return {number} Milliseconds since the tracer was installed.
   * @private
   */
  static now_() {
    return Math.round((performance.now() - shaka.test.IdbTracer.t0_) * 10) / 10;
  }

  /**
   * Assign a stable short id to an object, so the trace can refer to the same
   * database, transaction, or request more than once.
   *
   * @param {*} obj
   * @param {string} prefix
   * @return {?string}
   * @private
   */
  static id_(obj, prefix) {
    const T = shaka.test.IdbTracer;
    if (!obj || typeof obj !== 'object') {
      return null;
    }
    let id = T.ids_.get(obj);
    if (!id) {
      T.counters_[prefix] = (T.counters_[prefix] || 0) + 1;
      id = prefix + T.counters_[prefix];
      T.ids_.set(obj, id);
    }
    return id;
  }

  /**
   * Start a record for an operation.
   *
   * @param {string} op
   * @param {!Object} fields
   * @param {boolean} isAsync True if this operation can hang, and so should be
   *   watched by the wedge detector.
   * @return {!Object}
   * @private
   */
  static record_(op, fields, isAsync) {
    const T = shaka.test.IdbTracer;
    const rec = {
      seq: ++T.seq_,
      op: op,
      t: T.now_(),
      end: null,
      status: isAsync ? 'pending' : 'sync',
      spec: T.currentSpec_,
    };
    for (const key in fields) {
      if (fields[key] !== undefined && fields[key] !== null) {
        rec[key] = fields[key];
      }
    }
    if (T.records_.length < T.config_.maxRecords) {
      T.records_.push(rec);
    } else {
      T.dropped_++;
    }
    if (isAsync) {
      T.pending_.set(rec.seq, rec);
    }
    return rec;
  }

  /**
   * Close out a record.
   *
   * @param {!Object} rec
   * @param {string} status
   * @param {*=} error
   * @private
   */
  static finish_(rec, status, error) {
    const T = shaka.test.IdbTracer;
    if (rec.end !== null) {
      return;
    }
    rec.end = T.now_();
    rec.status = status;
    if (error) {
      rec.err = (error.name || '') + ': ' + (error.message || String(error));
    }
    T.pending_.delete(rec.seq);
  }

  /**
   * Note an intermediate event (upgradeneeded, blocked) on a record.
   *
   * @param {!Object} rec
   * @param {string} name
   * @private
   */
  static mark_(rec, name) {
    if (!rec.events) {
      rec.events = [];
    }
    rec.events.push({name: name, t: shaka.test.IdbTracer.now_()});
  }

  /**
   * Attach completion listeners to an IDBRequest.  These are passive listeners
   * and do not extend the life of the request's transaction.
   *
   * @param {!Object} rec
   * @param {*} request
   * @return {*}
   * @private
   */
  static trackRequest_(rec, request) {
    const T = shaka.test.IdbTracer;
    if (!request || !request.addEventListener) {
      T.finish_(rec, 'no-request');
      return request;
    }
    rec.req = T.id_(request, 'req');
    request.addEventListener('success', () => {
      T.finish_(rec, 'success');
      // An open() hands back a connection, whose own lifecycle events tell us
      // whether it ever got in the way of a later upgrade or delete.  Record
      // its id too: without it there is no way to pair an open against the
      // close that should have followed, and an unclosed connection is exactly
      // what blocks a delete.
      if (rec.op === 'open' && request.result) {
        rec.db = T.id_(request.result, 'db');
        T.trackDatabase_(request.result);
      }
    });
    request.addEventListener('error', () => {
      T.finish_(rec, 'error', request.error);
    });
    request.addEventListener('upgradeneeded', (event) => {
      T.mark_(rec, 'upgradeneeded');
      // An upgrade creates a versionchange transaction implicitly, without
      // going through IDBDatabase.transaction(), so it would otherwise be
      // invisible.  Track it explicitly; a hung versionchange transaction is a
      // known way for IndexedDB to stop responding.
      if (request.transaction) {
        const txnRec = T.record_('versionchange', {
          dbName: rec.name,
          oldVersion: event.oldVersion,
          newVersion: event.newVersion,
        }, true);
        T.trackTransaction_(txnRec, request.transaction);
      }
    });
    request.addEventListener('blocked', () => T.mark_(rec, 'blocked'));
    return request;
  }

  /**
   * Watch an open database connection for the events that surround a blocked
   * upgrade or delete.
   *
   * A "versionchange" event asks this connection to close so that another one
   * can upgrade or delete the database.  A connection that does not close in
   * response leaves the other request blocked indefinitely, which is one of the
   * ways IndexedDB stops responding.  Pairing these against the db.close calls
   * already in the trace shows whether the request was honored.
   *
   * @param {*} db
   * @private
   */
  static trackDatabase_(db) {
    const T = shaka.test.IdbTracer;
    if (!db || !db.addEventListener || T.trackedDbs_.has(db)) {
      return;
    }
    T.trackedDbs_.add(db);
    const dbId = T.id_(db, 'db');

    db.addEventListener('versionchange', (event) => {
      T.record_('db.versionchange', {
        db: dbId,
        dbName: db.name,
        oldVersion: event.oldVersion,
        newVersion: event.newVersion,
      }, false);
    });
    // Fired when the browser closes the connection out from under us, for
    // instance after the database is deleted or on an unrecoverable error.
    db.addEventListener('close', () => {
      T.record_('db.forceClose', {db: dbId, dbName: db.name}, false);
    });
    db.addEventListener('abort', () => {
      T.record_('db.abort', {db: dbId, dbName: db.name}, false);
    });
    db.addEventListener('error', () => {
      T.record_('db.error', {db: dbId, dbName: db.name}, false);
    });
  }

  /**
   * Extend an existing transaction() record to cover the transaction's whole
   * lifetime, rather than just the synchronous call that created it.
   *
   * @param {!Object} rec
   * @param {*} txn
   * @private
   */
  static trackTransaction_(rec, txn) {
    const T = shaka.test.IdbTracer;
    if (!txn || !txn.addEventListener) {
      T.finish_(rec, 'no-transaction');
      return;
    }
    rec.txn = T.id_(txn, 'txn');
    rec.mode = txn.mode;
    try {
      rec.stores = Array.from(txn.objectStoreNames);
    } catch (e) {
      // Ignore; not all implementations expose this the same way.
    }
    txn.addEventListener('complete', () => T.finish_(rec, 'complete'));
    txn.addEventListener('error', () => T.finish_(rec, 'error', txn.error));
    txn.addEventListener('abort', () => T.finish_(rec, 'abort', txn.error));
  }

  /**
   * Wrap a method so that calls to it are recorded.
   *
   * @param {*} proto The prototype object to patch.
   * @param {string} name The method to patch.
   * @param {string} op The name to record the operation under.
   * @param {function(*, !Array): !Object} describe Extracts metadata from the
   *   receiver and arguments.
   * @param {string} kind One of 'request', 'transaction', 'promise', 'sync'.
   * @private
   */
  static wrap_(proto, name, op, describe, kind) {
    const T = shaka.test.IdbTracer;
    if (!proto || !proto[name]) {
      return;
    }
    const original = proto[name];
    /**
     * @this {!Object}
     * @param {...*} args
     * @return {*}
     */
    proto[name] = function(...args) {
      let fields = {};
      try {
        fields = describe(this, args);
      } catch (e) {
        fields = {describeError: String(e)};
      }
      const rec = T.record_(op, fields, kind !== 'sync');

      let result;
      try {
        result = Reflect.apply(original, this, args);
      } catch (e) {
        T.finish_(rec, 'throw', e);
        throw e;
      }

      if (kind === 'request') {
        T.trackRequest_(rec, result);
        try {
          rec.txn = T.id_(result.transaction, 'txn');
        } catch (e) {
          // Some requests (open) have no transaction yet.
        }
      } else if (kind === 'transaction') {
        T.trackTransaction_(rec, result);
      } else if (kind === 'promise' && result && result.then) {
        result.then(
            () => T.finish_(rec, 'success'),
            (e) => T.finish_(rec, 'error', e));
      } else {
        // A synchronous call is already finished, but record the end time
        // anyway.  IDBDatabase.close() in particular is specified to return
        // immediately and defer the actual close, so if it ever does block,
        // the duration is exactly what we would want to see.
        T.finish_(rec, 'sync');
      }
      return result;
    };
  }

  /**
   * Wrap a cursor method.  These are void, but they cause the cursor's existing
   * request to fire again, so completion is tracked through that request.
   *
   * @param {*} proto
   * @param {string} name
   * @private
   */
  static wrapCursorMethod_(proto, name) {
    const T = shaka.test.IdbTracer;
    if (!proto || !proto[name]) {
      return;
    }
    const original = proto[name];
    /**
     * @this {!Object}
     * @param {...*} args
     * @return {*}
     */
    proto[name] = function(...args) {
      const rec = T.record_('cursor.' + name, {
        cursor: T.id_(this, 'cur'),
        txn: T.id_(this.request && this.request.transaction, 'txn'),
      }, true);

      // Attach before the call, so a synchronous throw still closes the record.
      const request = this.request;
      if (request && request.addEventListener) {
        const onSuccess = () => {
          T.finish_(rec, 'success');
          request.removeEventListener('success', onSuccess);
        };
        request.addEventListener('success', onSuccess);
      }

      try {
        return Reflect.apply(original, this, args);
      } catch (e) {
        T.finish_(rec, 'throw', e);
        throw e;
      }
    };
  }

  /**
   * Describe an IDBKeyRange or key argument without retaining the value.
   *
   * @param {*} key
   * @return {*}
   * @private
   */
  static describeKey_(key) {
    if (key === undefined || key === null) {
      return null;
    }
    if (typeof key === 'string') {
      return key.length > 64 ? key.substr(0, 64) + '...' : key;
    }
    if (typeof key === 'number' || typeof key === 'boolean') {
      return key;
    }
    if (Array.isArray(key)) {
      return key.map((k) => shaka.test.IdbTracer.describeKey_(k));
    }
    if (window.IDBKeyRange && key instanceof IDBKeyRange) {
      return {
        lower: shaka.test.IdbTracer.describeKey_(key.lower),
        upper: shaka.test.IdbTracer.describeKey_(key.upper),
        lowerOpen: key.lowerOpen,
        upperOpen: key.upperOpen,
      };
    }
    return typeof key;
  }

  /**
   * Estimate the serialized size of a value, so a replay can synthesize
   * something equivalent without us having to log the bytes.
   *
   * @param {*} value
   * @param {number} depth
   * @return {number}
   * @private
   */
  static byteSize_(value, depth) {
    const T = shaka.test.IdbTracer;
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'string') {
      return value.length * 2;
    }
    if (typeof value === 'number') {
      return 8;
    }
    if (typeof value === 'boolean') {
      return 4;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength;
    }
    // A raw ArrayBuffer is not a view, but still reports a byteLength.
    if (typeof value.byteLength === 'number') {
      return value.byteLength;
    }
    if (window.Blob && value instanceof Blob) {
      return value.size;
    }
    if (depth <= 0) {
      return 0;
    }
    if (Array.isArray(value)) {
      let sum = 0;
      // Sample large arrays rather than walking every element.
      const limit = Math.min(value.length, 64);
      for (let i = 0; i < limit; i++) {
        sum += T.byteSize_(value[i], depth - 1);
      }
      if (value.length > limit) {
        sum = Math.round(sum * value.length / limit);
      }
      return sum;
    }
    if (typeof value === 'object') {
      let sum = 0;
      for (const key in value) {
        sum += T.byteSize_(value[key], depth - 1);
      }
      return sum;
    }
    return 0;
  }

  /**
   * Describe the top-level shape of a stored value: which fields it has and how
   * big each one is.  This is what a replay needs in order to build a value of
   * the same size and structure.
   *
   * @param {*} value
   * @return {*}
   * @private
   */
  static describeValue_(value) {
    const T = shaka.test.IdbTracer;
    if (value === null || typeof value !== 'object') {
      return {type: typeof value, bytes: T.byteSize_(value, 3)};
    }
    if (ArrayBuffer.isView(value) || typeof value.byteLength === 'number') {
      return {type: 'binary', bytes: T.byteSize_(value, 1)};
    }
    const shape = {};
    let count = 0;
    for (const key in value) {
      if (count++ > 40) {
        shape['...'] = 'truncated';
        break;
      }
      shape[key] = T.byteSize_(value[key], 3);
    }
    return {type: 'object', fields: shape, bytes: T.byteSize_(value, 4)};
  }

  /**
   * @private
   */
  static installFactoryHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBFactory && window.IDBFactory.prototype;
    T.wrap_(proto, 'open', 'open',
        (self, args) => ({name: args[0], version: args[1]}), 'request');
    T.wrap_(proto, 'deleteDatabase', 'deleteDatabase',
        (self, args) => ({name: args[0]}), 'request');
    T.wrap_(proto, 'databases', 'databases', () => ({}), 'promise');
  }

  /**
   * @private
   */
  static installDatabaseHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBDatabase && window.IDBDatabase.prototype;
    T.wrap_(proto, 'transaction', 'transaction',
        (self, args) => ({
          db: T.id_(self, 'db'),
          dbName: self.name,
          stores: args[0],
          mode: args[1] || 'readonly',
        }), 'transaction');
    T.wrap_(proto, 'close', 'db.close',
        (self) => ({db: T.id_(self, 'db'), dbName: self.name}), 'sync');
    T.wrap_(proto, 'createObjectStore', 'createObjectStore',
        (self, args) => ({db: T.id_(self, 'db'), store: args[0]}), 'sync');
    T.wrap_(proto, 'deleteObjectStore', 'deleteObjectStore',
        (self, args) => ({db: T.id_(self, 'db'), store: args[0]}), 'sync');
  }

  /**
   * @private
   */
  static installStoreHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBObjectStore && window.IDBObjectStore.prototype;

    /**
     * @param {*} self
     * @return {!Object}
     */
    const base = (self) => ({
      store: self.name,
      txn: T.id_(self.transaction, 'txn'),
      mode: self.transaction && self.transaction.mode,
    });

    for (const name of ['add', 'put']) {
      T.wrap_(proto, name, name, (self, args) => {
        const fields = base(self);
        fields.key = T.describeKey_(args[1]);
        fields.value = T.describeValue_(args[0]);
        return fields;
      }, 'request');
    }

    const readers =
        ['get', 'getKey', 'getAll', 'getAllKeys', 'delete', 'count'];
    for (const name of readers) {
      T.wrap_(proto, name, name, (self, args) => {
        const fields = base(self);
        fields.key = T.describeKey_(args[0]);
        return fields;
      }, 'request');
    }

    T.wrap_(proto, 'clear', 'clear', (self) => base(self), 'request');

    // Index schema changes, which only happen inside a versionchange
    // transaction.
    T.wrap_(proto, 'createIndex', 'createIndex', (self, args) => ({
      store: self.name,
      index: args[0],
      keyPath: String(args[1]),
    }), 'sync');
    T.wrap_(proto, 'deleteIndex', 'deleteIndex', (self, args) => ({
      store: self.name,
      index: args[0],
    }), 'sync');

    for (const name of ['openCursor', 'openKeyCursor']) {
      T.wrap_(proto, name, name, (self, args) => {
        const fields = base(self);
        fields.key = T.describeKey_(args[0]);
        fields.direction = args[1];
        return fields;
      }, 'request');
    }
  }

  /**
   * @private
   */
  static installIndexHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBIndex && window.IDBIndex.prototype;

    /**
     * @param {*} self
     * @return {!Object}
     */
    const base = (self) => ({
      store: self.objectStore && self.objectStore.name,
      index: self.name,
      txn: T.id_(self.objectStore && self.objectStore.transaction, 'txn'),
    });

    const methods = ['get', 'getKey', 'getAll', 'getAllKeys', 'count',
      'openCursor', 'openKeyCursor'];
    for (const name of methods) {
      T.wrap_(proto, name, 'index.' + name, (self, args) => {
        const fields = base(self);
        fields.key = T.describeKey_(args[0]);
        return fields;
      }, 'request');
    }
  }

  /**
   * @private
   */
  static installCursorHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBCursor && window.IDBCursor.prototype;
    for (const name of ['continue', 'advance', 'continuePrimaryKey']) {
      T.wrapCursorMethod_(proto, name);
    }
    // update() and delete() return their own request, unlike the navigation
    // methods above.
    for (const name of ['update', 'delete']) {
      T.wrap_(proto, name, 'cursor.' + name,
          (self) => ({cursor: T.id_(self, 'cur')}), 'request');
    }
  }

  /**
   * @private
   */
  static installTransactionHooks_() {
    const T = shaka.test.IdbTracer;
    const proto = window.IDBTransaction && window.IDBTransaction.prototype;
    T.wrap_(proto, 'abort', 'txn.abort',
        (self) => ({txn: T.id_(self, 'txn')}), 'sync');
    T.wrap_(proto, 'commit', 'txn.commit',
        (self) => ({txn: T.id_(self, 'txn')}), 'sync');
  }

  /**
   * Record which spec each operation belongs to, so the trace can be lined up
   * against the test output.
   *
   * @private
   */
  static installSpecReporter_() {
    const T = shaka.test.IdbTracer;
    if (typeof jasmine === 'undefined' || !jasmine.getEnv) {
      return;
    }
    // Closure's externs for jasmine.Env do not declare addReporter, and the
    // conformance rules reject property access on an unknown type.
    const env = /** @type {{addReporter: function(!Object)}} */ (
      jasmine.getEnv());
    env.addReporter({
      specStarted: (result) => {
        T.currentSpec_ = result.fullName;
        T.specStartRec_ = T.record_('spec.start', {name: result.fullName},
            false);
      },
      specDone: (result) => {
        // A filtered-out spec touches nothing.  Drop its marker rather than
        // burying the trace under thousands of empty specs.
        const last = T.records_[T.records_.length - 1];
        if (result.status === 'excluded' && last === T.specStartRec_) {
          T.records_.pop();
          T.seq_--;
        } else {
          T.record_('spec.done', {
            name: result.fullName,
            result: result.status,
          }, false);
        }
        T.specStartRec_ = null;
        T.currentSpec_ = null;
      },
      jasmineDone: () => {
        // Always dump at the end, even if the watchdog already dumped.  The
        // watchdog's dump is a snapshot taken at the moment of the hang, while
        // this one is the complete record, and we want both.  Records carry
        // sequence numbers, so a reader can merge the two dumps.
        T.dump('run complete');
      },
    });
  }

  /**
   * JSON that cannot throw, whatever we hand it.
   *
   * @param {*} value
   * @return {string}
   * @private
   */
  static stringify_(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return '"<unserializable: ' + String(e) + '>"';
    }
  }
};

/** @private {boolean} */
shaka.test.IdbTracer.installed_ = false;

/** @private {Object} */
shaka.test.IdbTracer.config_ = null;

/** @private {!Array<!Object>} */
shaka.test.IdbTracer.records_ = [];

/** @private {!Map<number, !Object>} */
shaka.test.IdbTracer.pending_ = new Map();

/** @private {!WeakMap<!Object, string>} */
shaka.test.IdbTracer.ids_ = new WeakMap();

/** @private {!WeakSet<!Object>} */
shaka.test.IdbTracer.trackedDbs_ = new WeakSet();

/** @private {!Object<string, number>} */
shaka.test.IdbTracer.counters_ = {};

/** @private {number} */
shaka.test.IdbTracer.seq_ = 0;

/** @private {number} */
shaka.test.IdbTracer.dropped_ = 0;

/** @private {number} */
shaka.test.IdbTracer.t0_ = 0;

/** @private {boolean} */
shaka.test.IdbTracer.wedged_ = false;

/** @private {?string} */
shaka.test.IdbTracer.currentSpec_ = null;

/** @private {?Object} */
shaka.test.IdbTracer.specStartRec_ = null;

/** @private {string} */
shaka.test.IdbTracer.session_ = '';

/** @private {?number} */
shaka.test.IdbTracer.watchdog_ = null;
