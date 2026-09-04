/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// This file exists to patch fetch and the XMLHttpRequest prototype, so the
// usual bans on touching .prototype and on using non-arrow function
// expressions (which we need for a dynamic "this") do not apply here.
/* eslint-disable no-restricted-syntax */

/**
 * @fileoverview A tracing shim for network requests.  This file replaces
 * window.fetch and methods on the XMLHttpRequest prototype with wrappers, and
 * builds trace records whose fields vary by the request being recorded,
 * neither of which Closure can type.  The file-level suppress unblocks its
 * strict-property and unknown-type checks across the whole file.
 *
 * @suppress {checkTypes|missingProperties|strictMissingProperties}
 */

goog.provide('shaka.test.NetTracer');


/**
 * Records every network request the page makes, and which ones were still
 * outstanding when a test stopped making progress.
 *
 * Built for a storage test that hangs for its full two minute Jasmine timeout
 * on Safari, passing alone but failing among its neighbours.  Tracing
 * IndexedDB ruled storage out: the failing runs performed exactly the same
 * operations as the passing ones and left none pending.  A request that never
 * settles is what is left, and it looks the same as a request that was never
 * made unless something is watching.
 *
 * Enable with test.py --net-trace.  The trace records the shape of each
 * request, meaning method, url, status and byte count, never a body.
 */
shaka.test.NetTracer = class {
  /**
   * Wrap fetch and XMLHttpRequest.  Safe to call more than once.
   *
   * @param {Object=} config
   */
  static install(config) {
    const T = shaka.test.NetTracer;

    if (T.installed_) {
      return;
    }
    T.installed_ = true;

    T.config_ = Object.assign({
      // How long a request may be outstanding before it counts as stuck.  The
      // specs here give playback ten seconds, so anything past this is not
      // waiting on the network in any ordinary sense.
      stuckMs: 20000,
      maxRecords: 50000,
      // Records per console line.  Kept small because the log pipeline
      // truncates very long lines, and a truncated chunk loses every record.
      chunkSize: 25,
      urlLength: 120,
    }, config || {});

    T.t0_ = performance.now();
    T.records_ = [];
    T.pending_ = new Map();
    T.seq_ = 0;
    T.dropped_ = 0;
    T.currentSpec_ = null;
    T.reportedStuck_ = false;

    T.installFetchHook_();
    T.installXhrHooks_();
    T.installSpecReporter_();

    T.watchdog_ = setInterval(() => T.checkForStuck_(), 1000);

    T.session_ = Math.random().toString(36).slice(2, 10);
    console.log('[net-trace] Installed network tracer. session=' + T.session_);
  }

  /**
   * @return {number} Milliseconds since the tracer was installed.
   * @private
   */
  static now_() {
    return Math.round((performance.now() - shaka.test.NetTracer.t0_) * 10) / 10;
  }

  /**
   * @param {*} url
   * @return {string}
   * @private
   */
  static url_(url) {
    const T = shaka.test.NetTracer;
    const text = String(url);
    // Data URIs carry their payload in the url, and the tests use large ones.
    if (text.startsWith('data:')) {
      return 'data:[' + text.length + ' chars]';
    }
    return text.length > T.config_.urlLength ?
        text.slice(0, T.config_.urlLength) + '...' : text;
  }

  /**
   * Start a record for a request.
   *
   * @param {string} op
   * @param {!Object} fields
   * @return {!Object}
   * @private
   */
  static record_(op, fields) {
    const T = shaka.test.NetTracer;
    const rec = {
      seq: ++T.seq_,
      op: op,
      t: T.now_(),
      end: null,
      status: 'pending',
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
    T.pending_.set(rec.seq, rec);
    return rec;
  }

  /**
   * Close out a record.
   *
   * @param {!Object} rec
   * @param {string} status
   * @param {!Object=} fields
   * @private
   */
  static finish_(rec, status, fields) {
    const T = shaka.test.NetTracer;
    if (rec.end !== null) {
      return;
    }
    rec.end = T.now_();
    rec.status = status;
    for (const key in (fields || {})) {
      if (fields[key] !== undefined && fields[key] !== null) {
        rec[key] = fields[key];
      }
    }
    T.pending_.delete(rec.seq);
  }

  /**
   * @private
   */
  static installFetchHook_() {
    const T = shaka.test.NetTracer;
    if (!window.fetch) {
      return;
    }
    const original = window.fetch;
    // An arrow function here on purpose: fetch does not need a receiver, and
    // binding one is what the conformance rules object to.
    window.fetch = (input, init) => {
      const url = (input && input.url) ? input.url : input;
      const method =
          (init && init.method) || (input && input.method) || 'GET';
      const rec = T.record_('fetch', {url: T.url_(url), method: method});

      let promise;
      try {
        promise = original(input, init);
      } catch (error) {
        T.finish_(rec, 'threw', {err: String(error)});
        throw error;
      }

      return promise.then((response) => {
        T.finish_(rec, 'response', {httpStatus: response.status});
        return response;
      }, (error) => {
        T.finish_(rec, 'rejected',
            {err: (error.name || '') + ': ' + (error.message || '')});
        throw error;
      });
    };
  }

  /**
   * @private
   */
  static installXhrHooks_() {
    const T = shaka.test.NetTracer;
    if (!window.XMLHttpRequest) {
      return;
    }
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;

    // Bracket access throughout, because these are properties of our own
    // hung on someone else's object, which Closure has no way to know about.
    /**
     * @this {!XMLHttpRequest}
     * @param {string} method
     * @param {string} url
     * @param {...*} rest
     * @return {*}
     */
    proto.open = function(method, url, ...rest) {
      this['__netTraceMethod'] = method;
      this['__netTraceUrl'] = url;
      return open.call(this, method, url, ...rest);
    };

    /**
     * @this {!XMLHttpRequest}
     * @param {...*} args
     * @return {*}
     */
    proto.send = function(...args) {
      const xhr = this;
      const rec = T.record_('xhr', {
        url: T.url_(xhr['__netTraceUrl']),
        method: xhr['__netTraceMethod'] || 'GET',
      });

      // Every terminal event is listened for.  Watching only "load" would
      // leave an aborted or failed request looking identical to one that never
      // came back, which is the distinction this whole file exists to make.
      const done = (status) => {
        T.finish_(rec, status, {
          httpStatus: xhr.status,
          bytes: xhr.responseType === 'arraybuffer' && xhr.response ?
              xhr.response.byteLength : undefined,
        });
      };
      xhr.addEventListener('load', () => done('load'));
      xhr.addEventListener('error', () => done('error'));
      xhr.addEventListener('abort', () => done('abort'));
      xhr.addEventListener('timeout', () => done('timeout'));

      try {
        return send.apply(xhr, args);
      } catch (error) {
        T.finish_(rec, 'threw', {err: String(error)});
        throw error;
      }
    };
  }

  /**
   * Look for a request that has been outstanding long enough to count as
   * stuck, and dump the trace the first time one is found.
   *
   * @private
   */
  static checkForStuck_() {
    const T = shaka.test.NetTracer;
    if (T.reportedStuck_) {
      return;
    }
    const now = T.now_();
    for (const rec of T.pending_.values()) {
      const age = now - rec.t;
      if (age > T.config_.stuckMs) {
        T.reportedStuck_ = true;
        console.error('[net-trace] STUCK REQUEST: ' + rec.op + ' ' +
                      rec.method + ' ' + rec.url + ' (seq ' + rec.seq +
                      ') outstanding for ' + Math.round(age) + 'ms');
        T.dump('stuck: seq=' + rec.seq);
        return;
      }
    }
  }

  /**
   * Dump the trace to the console.
   *
   * @param {string} reason
   */
  static dump(reason) {
    const T = shaka.test.NetTracer;
    const pending = Array.from(T.pending_.values());

    // The summary goes first, because it is the part most worth having if the
    // log pipeline truncates what follows.
    console.log('[net-trace] SUMMARY ' + T.session_ + ' ' + T.stringify_({
      reason: reason,
      spec: T.currentSpec_,
      totalRecords: T.records_.length,
      droppedRecords: T.dropped_,
      pendingCount: pending.length,
      pending: pending.slice(0, 20),
    }));

    const total = Math.ceil(T.records_.length / T.config_.chunkSize);
    console.log('[net-trace] BEGIN session=' + T.session_ + ' chunks=' + total +
                ' records=' + T.records_.length);
    let index = 0;
    for (let i = 0; i < T.records_.length; i += T.config_.chunkSize) {
      index++;
      console.log('[net-trace] CHUNK ' + T.session_ + ' ' + index + '/' +
                  total + ' ' +
                  T.stringify_(T.records_.slice(i, i + T.config_.chunkSize)));
    }
    console.log('[net-trace] END');
  }

  /**
   * @private
   */
  static installSpecReporter_() {
    const T = shaka.test.NetTracer;
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
        T.record_('spec.start', {name: result.fullName});
        T.finish_(T.records_[T.records_.length - 1], 'sync');
      },
      specDone: (result) => {
        T.record_('spec.done', {name: result.fullName, result: result.status});
        T.finish_(T.records_[T.records_.length - 1], 'sync');
        T.currentSpec_ = null;
      },
      jasmineDone: () => {
        // Dump at the end regardless of whether the watchdog already did.  Its
        // dump is a snapshot at the moment of the hang; this one is complete,
        // and sequence numbers let a reader merge the two.
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
    } catch (error) {
      return '"unserializable: ' + (error.name || 'error') + '"';
    }
  }
};


/** @private {boolean} */
shaka.test.NetTracer.installed_ = false;

/** @private {!Object} */
shaka.test.NetTracer.config_ = {};

/** @private {number} */
shaka.test.NetTracer.t0_ = 0;

/** @private {!Array<!Object>} */
shaka.test.NetTracer.records_ = [];

/** @private {!Map<number, !Object>} */
shaka.test.NetTracer.pending_ = new Map();

/** @private {number} */
shaka.test.NetTracer.seq_ = 0;

/** @private {number} */
shaka.test.NetTracer.dropped_ = 0;

/** @private {?string} */
shaka.test.NetTracer.currentSpec_ = null;

/** @private {string} */
shaka.test.NetTracer.session_ = '';

/** @private {boolean} */
shaka.test.NetTracer.reportedStuck_ = false;

/** @private {?number} */
shaka.test.NetTracer.watchdog_ = null;
