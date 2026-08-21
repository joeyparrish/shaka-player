/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// This file exists to patch the MediaSource and media element prototypes, so
// the usual bans on touching .prototype and on using non-arrow function
// expressions (which we need for a dynamic "this") do not apply here.
/* eslint-disable no-restricted-syntax */

/**
 * @fileoverview A tracing shim for MediaSource and HTMLMediaElement.  This
 * file replaces methods and property setters on their prototypes with
 * wrappers, and builds trace records whose fields vary by the operation being
 * recorded, neither of which Closure can type.  The file-level suppress
 * unblocks its strict-property and unknown-type checks across the whole file.
 *
 * @suppress {checkTypes|missingProperties|strictMissingProperties}
 */

goog.provide('shaka.test.MseTracer');


/**
 * Records what the player asks of MediaSource and of the media element, and
 * what the browser reports back, so that a run where playback starts can be
 * diffed against one where it does not.
 *
 * Built for the HLS rendition switch that stalls on Safari, where the element
 * is left seeking forever with no error to explain it.  A stall like that says
 * nothing about its own cause: what it looks like is the absence of an event,
 * so the only way to see it is to compare the calls and events either side of
 * the point where the two runs stop matching.
 *
 * Enable with test.py --mse-trace.  The trace records shapes, not media: byte
 * counts, buffered ranges, and times, never the appended bytes.
 */
shaka.test.MseTracer = class {
  /**
   * Wrap the MediaSource and media element APIs.  Safe to call more than once.
   *
   * @param {Object=} config
   */
  static install(config) {
    const T = shaka.test.MseTracer;

    if (T.installed_) {
      return;
    }
    T.installed_ = true;

    T.config_ = Object.assign({
      // Enough for a spec that switches renditions eighteen times.  A trace
      // that runs past this keeps its head, which is where a divergence
      // between two runs shows up, rather than its tail.
      maxRecords: 20000,
      // Records per console line when dumping.  Kept small because the log
      // pipeline truncates very long lines, and a truncated chunk loses every
      // record in it.
      chunkSize: 25,
    }, config || {});

    T.t0_ = performance.now();
    T.records_ = [];
    T.ids_ = new WeakMap();
    T.counters_ = {};
    T.seq_ = 0;
    T.dropped_ = 0;
    T.currentSpec_ = null;
    T.mediaElements_ = new Set();

    T.installMediaSourceHooks_();
    T.installSourceBufferHooks_();
    T.installMediaElementHooks_();
    T.installSpecReporter_();

    // Sequence numbers restart in every browser session, so tag each dump with
    // a session id to keep runs apart in a log that holds several.
    T.session_ = Math.random().toString(36).slice(2, 10);

    console.log('[mse-trace] Installed MSE tracer. session=' + T.session_);
  }

  /**
   * Dump the trace to the console.
   *
   * @param {string} reason
   */
  static dump(reason) {
    const T = shaka.test.MseTracer;

    // Emit a compact summary first.  If the full trace is truncated by the log
    // pipeline, this is the part we most need to survive.
    const summary = {
      reason: reason,
      spec: T.currentSpec_,
      totalRecords: T.records_.length,
      droppedRecords: T.dropped_,
      elements: Array.from(T.mediaElements_).map((v) => T.elementState_(v)),
      tail: T.records_.slice(-60),
    };
    console.log('[mse-trace] SUMMARY ' + T.session_ + ' ' +
                T.stringify_(summary));

    const total = Math.ceil(T.records_.length / T.config_.chunkSize);
    console.log('[mse-trace] BEGIN session=' + T.session_ + ' chunks=' + total +
                ' records=' + T.records_.length);
    let index = 0;
    for (let i = 0; i < T.records_.length; i += T.config_.chunkSize) {
      const chunk = T.records_.slice(i, i + T.config_.chunkSize);
      index++;
      console.log('[mse-trace] CHUNK ' + T.session_ + ' ' + index + '/' +
                  total + ' ' + T.stringify_(chunk));
    }
    console.log('[mse-trace] END');
  }

  /**
   * Drop everything recorded so far.  Called between specs so that a trace
   * covers one spec only.
   */
  static reset() {
    const T = shaka.test.MseTracer;
    T.records_ = [];
    T.dropped_ = 0;
    T.seq_ = 0;
  }

  /**
   * Name the code that is writing currentTime.
   *
   * Knowing that the playhead moved is not enough to act on: several parts of
   * the player seek, and a workaround aimed at the wrong one is worse than
   * none, having looked like it was tested.  Only the frames inside the player
   * are worth keeping, so drop this file's own frames and anything below the
   * shim.
   *
   * @return {?string}
   * @private
   */
  static caller_() {
    const stack = new Error().stack;
    if (!stack) {
      return null;
    }
    const frames = [];
    for (const line of stack.split('\n')) {
      if (line.indexOf('mse_tracer') >= 0 || line.indexOf('Error') === 0) {
        continue;
      }
      const match = line.match(/([\w$.]+\.js):(\d+)/);
      if (match) {
        frames.push(match[1] + ':' + match[2]);
      } else {
        const name = line.trim().split(/\s+/)[0];
        if (name) {
          frames.push(name);
        }
      }
      if (frames.length >= 4) {
        break;
      }
    }
    return frames.join(' < ');
  }

  /**
   * @return {boolean} True if anything media-related was recorded for the
   *   current spec.
   * @private
   */
  static sawMedia_() {
    const T = shaka.test.MseTracer;
    return T.records_.some((rec) => rec['op'].indexOf('spec.') !== 0);
  }

  /**
   * @return {number} Milliseconds since the tracer was installed.
   * @private
   */
  static now_() {
    return Math.round((performance.now() - shaka.test.MseTracer.t0_) * 10) / 10;
  }

  /**
   * Assign a stable short id to an object, so the trace can refer to the same
   * source buffer or media element more than once.
   *
   * @param {*} obj
   * @param {string} prefix
   * @return {?string}
   * @private
   */
  static id_(obj, prefix) {
    const T = shaka.test.MseTracer;
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
   * Round a media time, so that traces from two runs can be compared without
   * floating point noise getting in the way.
   *
   * @param {number} value
   * @return {?number}
   * @private
   */
  static time_(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    return Math.round(value * 1000) / 1000;
  }

  /**
   * Render a TimeRanges as an array of pairs.  This is the field that matters
   * most in a stall, since what the element will play is decided by what it
   * believes is buffered.
   *
   * @param {TimeRanges} ranges
   * @return {!Array<!Array<number>>}
   * @private
   */
  static ranges_(ranges) {
    const T = shaka.test.MseTracer;
    const out = [];
    if (!ranges) {
      return out;
    }
    for (let i = 0; i < ranges.length; i++) {
      out.push([T.time_(ranges.start(i)), T.time_(ranges.end(i))]);
    }
    return out;
  }

  /**
   * Snapshot everything about a media element that bears on whether it can
   * make progress.
   *
   * @param {!HTMLMediaElement} video
   * @return {!Object}
   * @private
   */
  static elementState_(video) {
    const T = shaka.test.MseTracer;
    return {
      el: T.id_(video, 'v'),
      currentTime: T.time_(video.currentTime),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      rate: video.playbackRate,
      duration: T.time_(video.duration),
      buffered: T.ranges_(video.buffered),
      seekable: T.ranges_(video.seekable),
      error: video.error ? video.error.code : null,
    };
  }

  /**
   * Snapshot a source buffer.  Recorded next to every call and event so that a
   * diff can tell which side changed first.
   *
   * @param {!SourceBuffer} buffer
   * @return {!Object}
   * @private
   */
  static bufferState_(buffer) {
    const T = shaka.test.MseTracer;
    const state = {
      sb: T.id_(buffer, 'sb'),
      updating: buffer.updating,
    };
    // Reading buffered throws if the buffer has been removed from its parent
    // MediaSource, which is exactly the sort of state worth recording.
    try {
      state.buffered = T.ranges_(buffer.buffered);
    } catch (error) {
      state.buffered = 'threw: ' + error.name;
    }
    try {
      state.timestampOffset = T.time_(buffer.timestampOffset);
      state.appendWindowStart = T.time_(buffer.appendWindowStart);
      state.appendWindowEnd = T.time_(buffer.appendWindowEnd);
      state.mode = buffer.mode;
    } catch (error) {
      // Ignore: these throw under the same conditions as buffered.
    }
    return state;
  }

  /**
   * Add a record to the trace.
   *
   * @param {string} op
   * @param {!Object} fields
   * @return {!Object}
   * @private
   */
  static record_(op, fields) {
    const T = shaka.test.MseTracer;
    const rec = {
      seq: ++T.seq_,
      op: op,
      t: T.now_(),
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
    return rec;
  }

  /**
   * Wrap a method, recording the call and either its return or its throw.
   *
   * @param {!Object} proto
   * @param {string} name
   * @param {string} op
   * @param {function(!Object, !Array<*>)} describe Fills in the record from the
   *   receiver and the arguments.
   * @private
   */
  static wrapMethod_(proto, name, op, describe) {
    const T = shaka.test.MseTracer;
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
      const fields = {};
      try {
        describe(fields, [this].concat(args));
      } catch (error) {
        fields['describeError'] = String(error);
      }
      const rec = T.record_(op, fields);
      try {
        const result = original.apply(this, args);
        rec['ok'] = true;
        return result;
      } catch (error) {
        rec['threw'] = (error.name || '') + ': ' + (error.message || '');
        throw error;
      }
    };
  }

  /**
   * Wrap a property setter, recording what was written.  The player drives
   * seeking and rate through these, so a trace without them cannot explain a
   * stalled seek.
   *
   * @param {!Object} proto
   * @param {string} name
   * @param {string} op
   * @param {function(!Object, !Object, *)} describe
   * @private
   */
  static wrapSetter_(proto, name, op, describe) {
    const T = shaka.test.MseTracer;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || !descriptor.set || !descriptor.configurable) {
      return;
    }
    const originalSet = descriptor.set;
    const originalGet = descriptor.get;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: originalGet,
      /**
       * @this {!Object}
       * @param {*} value
       */
      set: function(value) {
        const fields = {};
        try {
          describe(fields, this, value);
        } catch (error) {
          fields['describeError'] = String(error);
        }
        const rec = T.record_(op, fields);
        try {
          originalSet.call(this, value);
          rec['ok'] = true;
        } catch (error) {
          rec['threw'] = (error.name || '') + ': ' + (error.message || '');
          throw error;
        }
      },
    });
  }

  /**
   * @private
   */
  static installMediaSourceHooks_() {
    const T = shaka.test.MseTracer;
    if (!window.MediaSource) {
      return;
    }
    const proto = MediaSource.prototype;

    // Wrapped by hand rather than through wrapMethod_, because this is also
    // where each source buffer first becomes reachable, and so where its own
    // event listeners have to be attached.
    const addSourceBuffer = proto.addSourceBuffer;
    /**
     * @this {!MediaSource}
     * @param {string} type
     * @return {!SourceBuffer}
     */
    proto.addSourceBuffer = function(type) {
      const rec = T.record_('ms.addSourceBuffer', {
        ms: T.id_(this, 'ms'),
        type: type,
        readyState: this.readyState,
      });
      let buffer;
      try {
        buffer = addSourceBuffer.call(this, type);
      } catch (error) {
        rec['threw'] = (error.name || '') + ': ' + (error.message || '');
        throw error;
      }
      rec['ok'] = true;
      rec['sb'] = T.id_(buffer, 'sb');
      T.watchSourceBuffer_(buffer);
      return buffer;
    };
    T.wrapMethod_(proto, 'removeSourceBuffer', 'ms.removeSourceBuffer',
        (fields, args) => {
          fields['ms'] = T.id_(args[0], 'ms');
          fields['sb'] = T.id_(args[1], 'sb');
          fields['readyState'] = args[0].readyState;
        });
    T.wrapMethod_(proto, 'endOfStream', 'ms.endOfStream', (fields, args) => {
      fields['ms'] = T.id_(args[0], 'ms');
      fields['reason'] = args[1] || '';
      fields['readyState'] = args[0].readyState;
    });
    T.wrapSetter_(proto, 'duration', 'ms.duration', (fields, ms, value) => {
      fields['ms'] = T.id_(ms, 'ms');
      fields['value'] = T.time_(/** @type {number} */(value));
      fields['readyState'] = ms.readyState;
    });
  }

  /**
   * @private
   */
  static installSourceBufferHooks_() {
    const T = shaka.test.MseTracer;
    if (!window.SourceBuffer) {
      return;
    }
    const proto = SourceBuffer.prototype;

    T.wrapMethod_(proto, 'appendBuffer', 'sb.appendBuffer', (fields, args) => {
      const data = args[1];
      Object.assign(fields, T.bufferState_(
          /** @type {!SourceBuffer} */(args[0])));
      fields['bytes'] = data && data.byteLength ? data.byteLength : 0;
    });
    T.wrapMethod_(proto, 'remove', 'sb.remove', (fields, args) => {
      Object.assign(fields, T.bufferState_(
          /** @type {!SourceBuffer} */(args[0])));
      fields['start'] = T.time_(/** @type {number} */(args[1]));
      fields['end'] = T.time_(/** @type {number} */(args[2]));
    });
    T.wrapMethod_(proto, 'abort', 'sb.abort', (fields, args) => {
      Object.assign(fields, T.bufferState_(
          /** @type {!SourceBuffer} */(args[0])));
    });
    T.wrapMethod_(proto, 'changeType', 'sb.changeType', (fields, args) => {
      Object.assign(fields, T.bufferState_(
          /** @type {!SourceBuffer} */(args[0])));
      fields['type'] = args[1];
    });

    const setters = [
      ['timestampOffset', 'sb.timestampOffset'],
      ['appendWindowStart', 'sb.appendWindowStart'],
      ['appendWindowEnd', 'sb.appendWindowEnd'],
      ['mode', 'sb.mode'],
    ];
    for (const [name, op] of setters) {
      T.wrapSetter_(proto, name, op, (fields, buffer, value) => {
        Object.assign(fields, T.bufferState_(
            /** @type {!SourceBuffer} */(buffer)));
        fields['value'] = typeof value === 'number' ?
            T.time_(/** @type {number} */(value)) : String(value);
      });
    }
  }

  /**
   * Record the events a source buffer raises.  An append is asynchronous, so
   * the call record says only that we asked; updateend is what says the data
   * landed, and its absence is what a stalled append looks like.
   *
   * @param {!SourceBuffer} buffer
   * @private
   */
  static watchSourceBuffer_(buffer) {
    const T = shaka.test.MseTracer;
    const events = ['updatestart', 'update', 'updateend', 'error', 'abort'];
    for (const type of events) {
      buffer.addEventListener(type, () => {
        T.record_('sb.' + type, T.bufferState_(buffer));
      });
    }
  }

  /**
   * @private
   */
  static installMediaElementHooks_() {
    const T = shaka.test.MseTracer;
    const proto = HTMLMediaElement.prototype;

    T.wrapMethod_(proto, 'play', 'video.play', (fields, args) => {
      Object.assign(fields, T.elementState_(
          /** @type {!HTMLMediaElement} */(args[0])));
      T.watchElement_(/** @type {!HTMLMediaElement} */(args[0]));
    });
    T.wrapMethod_(proto, 'pause', 'video.pause', (fields, args) => {
      Object.assign(fields, T.elementState_(
          /** @type {!HTMLMediaElement} */(args[0])));
    });
    T.wrapMethod_(proto, 'load', 'video.load', (fields, args) => {
      Object.assign(fields, T.elementState_(
          /** @type {!HTMLMediaElement} */(args[0])));
    });

    T.wrapSetter_(proto, 'currentTime', 'video.currentTime',
        (fields, video, value) => {
          Object.assign(fields, T.elementState_(
              /** @type {!HTMLMediaElement} */(video)));
          fields['value'] = T.time_(/** @type {number} */(value));
          fields['from'] = T.caller_();
          T.watchElement_(/** @type {!HTMLMediaElement} */(video));
        });
    T.wrapSetter_(proto, 'playbackRate', 'video.playbackRate',
        (fields, video, value) => {
          Object.assign(fields, T.elementState_(
              /** @type {!HTMLMediaElement} */(video)));
          fields['value'] = value;
        });
    T.wrapSetter_(proto, 'src', 'video.src', (fields, video, value) => {
      fields['el'] = T.id_(video, 'v');
      fields['value'] = String(value).slice(0, 80);
      T.watchElement_(/** @type {!HTMLMediaElement} */(video));
    });
  }

  /**
   * Start recording events from a media element, once.
   *
   * @param {!HTMLMediaElement} video
   * @private
   */
  static watchElement_(video) {
    const T = shaka.test.MseTracer;
    if (T.mediaElements_.has(video)) {
      return;
    }
    T.mediaElements_.add(video);

    // seeking without a matching seeked is the shape of the failure, so the
    // pair matters more than anything else here.  waiting and stalled say the
    // element wants data it does not have.
    const events = [
      'seeking', 'seeked', 'waiting', 'stalled', 'playing', 'play', 'pause',
      'ratechange', 'canplay', 'canplaythrough', 'loadedmetadata',
      'loadeddata', 'emptied', 'abort', 'error', 'ended', 'durationchange',
      'progress', 'suspend',
    ];
    for (const type of events) {
      video.addEventListener(type, () => {
        T.record_('video.' + type, T.elementState_(video));
      });
    }

    // timeupdate is throttled by the browser and is the only positive evidence
    // that playback is advancing, so keep it, but it is noisy: record it only
    // when the reported time actually changed.
    let lastTime = null;
    video.addEventListener('timeupdate', () => {
      const now = T.time_(video.currentTime);
      if (now !== lastTime) {
        lastTime = now;
        T.record_('video.timeupdate', T.elementState_(video));
      }
    });
  }

  /**
   * Tag records with the spec that produced them, and dump a trace when a spec
   * ends, so a passing run and a failing one can be compared directly.
   *
   * @private
   */
  static installSpecReporter_() {
    const T = shaka.test.MseTracer;
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
        T.reset();
        T.record_('spec.start', {name: result.fullName});
      },
      specDone: (result) => {
        T.record_('spec.done', {
          name: result.fullName,
          status: result.status,
        });
        // Both outcomes are dumped on purpose.  A failing trace on its own
        // shows a stall but not what a healthy switch looks like, and the
        // difference between the two is the whole point.
        //
        // Most specs in a run never touch media, and a filtered run skips
        // thousands of them.  Dumping those would bury the traces we want in
        // orders of magnitude more noise, so say nothing unless the spec
        // actually drove MediaSource or a media element.
        if (T.sawMedia_()) {
          T.dump('spec ' + result.status + ': ' + result.fullName);
        }
        T.currentSpec_ = null;
      },
    });
  }

  /**
   * JSON with a guard, since a trace that cannot be serialized is worse than
   * no trace: it would throw inside the reporter and take the run with it.
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
shaka.test.MseTracer.installed_ = false;

/** @private {!Object} */
shaka.test.MseTracer.config_ = {};

/** @private {number} */
shaka.test.MseTracer.t0_ = 0;

/** @private {!Array<!Object>} */
shaka.test.MseTracer.records_ = [];

/** @private {!WeakMap<!Object, string>} */
shaka.test.MseTracer.ids_ = new WeakMap();

/** @private {!Object<string, number>} */
shaka.test.MseTracer.counters_ = {};

/** @private {number} */
shaka.test.MseTracer.seq_ = 0;

/** @private {number} */
shaka.test.MseTracer.dropped_ = 0;

/** @private {?string} */
shaka.test.MseTracer.currentSpec_ = null;

/** @private {string} */
shaka.test.MseTracer.session_ = '';

/** @private {!Set<!HTMLMediaElement>} */
shaka.test.MseTracer.mediaElements_ = new Set();
