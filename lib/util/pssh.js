/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

goog.provide('shaka.util.Pssh');

goog.require('goog.asserts');
goog.require('shaka.log');
goog.require('shaka.util.BufferUtils');
goog.require('shaka.util.Mp4Parser');
goog.require('shaka.util.Uint8ArrayUtils');


/* eslint-disable */
// cspell: disable

(function() {

const utf8TextDecoder = new TextDecoder('utf-8');
const PBF_VARINT  = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
const PBF_FIXED64 = 1; // 64-bit: double, fixed64, sfixed64
const PBF_BYTES   = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
const PBF_FIXED32 = 5; // 32-bit: float, fixed32, sfixed32

shaka.util.PbfReader = class {
    /**
     * @param {!BufferSource} buf
     */
    constructor(buf) {
        /** @type {!Uint8Array} */
        this.buf = shaka.util.BufferUtils.toUint8(buf);

        /** @type {!DataView} */
        this.dataView = shaka.util.BufferUtils.toDataView(buf);

        /** @type {number} */
        this.pos = 0;

        /** @type {number} */
        this.type = 0;

        /** @type {number} */
        this._valueStart = -1;

        /** @type {number} */
        this.length = this.buf.length;
    }

    /**
     * @param {boolean} [isSigned]
     * @return {number}
     */
    readVarint(isSigned) {
        const buf = this.buf;
        const b0 = buf[this.pos++];
        if (b0 < 0x80) return b0;

        let val = b0 & 0x7f, b;
        b = buf[this.pos++]; val |= (b & 0x7f) << 7;  if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 14; if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 21; if (b < 0x80) return val;
        b = buf[this.pos];   val |= (b & 0x0f) << 28;

        return readVarintRemainder(val, isSigned, this);
    }

    /**
     * @return {string}
     */
    readString() {
        const end = this.readVarint() + this.pos;
        const pos = this.pos;
        this.pos = end;
        return utf8TextDecoder.decode(this.buf.subarray(pos, end));
    }

    /**
     * @return {!Uint8Array}
     */
    readBytes() {
        const end = this.readVarint() + this.pos,
            buffer = this.buf.subarray(this.pos, end);
        this.pos = end;
        return buffer;
    }

    /**
     * Advance to the next field. Returns the field number, or 0 at end-of-message.
     * @param {number} [end]
     */
    nextField(end = this.length) {
        if (this.pos === this._valueStart) this.skip(this.type);
        if (this.pos >= end) return 0;
        const tag = this.readVarint();
        this.type = tag & 0x7;
        this._valueStart = this.pos;
        return tag >>> 3;
    }

    /** @param {number} val */
    skip(val) {
        const type = val & 0x7;
        if (type === PBF_VARINT) while (this.buf[this.pos++] > 0x7f) {}
        else if (type === PBF_BYTES) this.pos = this.readVarint() + this.pos;
        else if (type === PBF_FIXED32) this.pos += 4;
        else if (type === PBF_FIXED64) this.pos += 8;
        else throw new Error(`Unimplemented type: ${type}`);
    }
}

/**
 * @param {number} l
 * @param {boolean | undefined} s
 * @param {shaka.util.PbfReader} p
 * @return {number}
 */
function readVarintRemainder(l, s, p) {
    const buf = p.buf;
    let h, b;

    b = buf[p.pos++]; h  = (b & 0x70) >> 4;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 3;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 10; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 17; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 24; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x01) << 31; if (b < 0x80) return toNum(l, h, s);

    throw new Error('Expected varint not more than 10 bytes');
}

/**
 * @param {number} low
 * @param {number} high
 * @param {boolean} [isSigned]
 * @return {number}
 */
function toNum(low, high, isSigned) {
    return isSigned ? high * 0x100000000 + (low >>> 0) : ((high >>> 0) * 0x100000000) + (low >>> 0);
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

/**
 * @param {Uint8Array} buf
 * @param {number} pos
 * @param {number} end
 * @return {string}
 */
function readUtf8(buf, pos, end) {
    let str = '';
    let i = pos;

    while (i < end) {
        const b0 = buf[i];
        let c = null; // codepoint
        let bytesPerSequence =
            b0 > 0xEF ? 4 :
            b0 > 0xDF ? 3 :
            b0 > 0xBF ? 2 : 1;

        if (i + bytesPerSequence > end) break;

        let b1, b2, b3;

        if (bytesPerSequence === 1) {
            if (b0 < 0x80) {
                c = b0;
            }
        } else if (bytesPerSequence === 2) {
            b1 = buf[i + 1];
            if ((b1 & 0xC0) === 0x80) {
                c = (b0 & 0x1F) << 0x6 | (b1 & 0x3F);
                if (c <= 0x7F) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 3) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0xC | (b1 & 0x3F) << 0x6 | (b2 & 0x3F);
                if (c <= 0x7FF || (c >= 0xD800 && c <= 0xDFFF)) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 4) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            b3 = buf[i + 3];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0x12 | (b1 & 0x3F) << 0xC | (b2 & 0x3F) << 0x6 | (b3 & 0x3F);
                if (c <= 0xFFFF || c >= 0x110000) {
                    c = null;
                }
            }
        }

        if (c === null) {
            c = 0xFFFD;
            bytesPerSequence = 1;

        } else if (c > 0xFFFF) {
            c -= 0x10000;
            str += String.fromCharCode(c >>> 10 & 0x3FF | 0xD800);
            c = 0xDC00 | c & 0x3FF;
        }

        str += String.fromCharCode(c);
        i += bytesPerSequence;
    }

    return str;
}

})();

/* eslint-enable */
// cspell: enable

/**
 * @summary
 * Parse a PSSH box and extract the system IDs.
 */
shaka.util.Pssh = class {
  /**
   * @param {shaka.util.PbfReader} pbf
   * @param {number=} end
   * @return {*}
   */
  static readWidevinePsshData(pbf, end) {
    const obj = {
      algorithm: 0,
      key_id: [],
      provider: '',
      content_id: undefined,
      policy: '',
      crypto_period_index: 0,
      grouped_license: undefined,
      protection_scheme: 0,
    };

    let field;
    while ((field = pbf.nextField(end))) {
      if (field === 1) {
        obj.algorithm = pbf.readVarint();
      } else if (field === 2) {
        obj.key_id.push(pbf.readBytes());
      } else if (field === 3) {
        obj.provider = pbf.readString();
      } else if (field === 4) {
        obj.content_id = pbf.readBytes();
      } else if (field === 6) {
        obj.policy = pbf.readString();
      } else if (field === 7) {
        obj.crypto_period_index = pbf.readVarint();
      } else if (field === 8) {
        obj.grouped_license = pbf.readBytes();
      } else if (field === 9) {
        obj.protection_scheme = pbf.readVarint();
      }
    }

    return obj;
  }

  /**
   * @param {!Uint8Array} psshBox
   */
  constructor(psshBox) {
    /**
     * In hex.
     * @type {!Array<string>}
     */
    this.systemIds = [];

    /**
     * Array with the pssh boxes found.
     * @type {!Array<!Uint8Array>}
     */
    this.data = [];

    /** @type {!Array<*>} */
    this.parsedData = [];

    new shaka.util.Mp4Parser()
        .boxes([
          'moov',
          'moof',
        ], shaka.util.Mp4Parser.children)
        .fullBox('pssh', (box) => this.parsePsshBox_(box))
        .parse(psshBox);

    if (this.data.length == 0) {
      shaka.log.v2('No pssh box found!');
    }
  }


  /**
   * @param {!shaka.extern.ParsedBox} box
   * @private
   */
  parsePsshBox_(box) {
    goog.asserts.assert(
        box.version != null,
        'PSSH boxes are full boxes and must have a valid version');

    goog.asserts.assert(
        box.flags != null,
        'PSSH boxes are full boxes and must have a valid flag');

    if (box.version > 1) {
      shaka.log.warning('Unrecognized PSSH version found!');
      return;
    }

    // The "reader" gives us a view on the payload of the box.  Create a new
    // view that contains the whole box.
    const dataView = box.reader.getDataView();
    goog.asserts.assert(
        dataView.byteOffset >= 12, 'DataView at incorrect position');
    const pssh = shaka.util.BufferUtils.toUint8(dataView, -12, box.size);
    this.data.push(pssh);

    try {
      this.parsedData.push(
          shaka.util.Pssh.readWidevinePsshData(new shaka.util.PbfReader(pssh)));
    } catch (error) {}

    const systemIdData = box.reader.readBytes(16,
        // Don't clone.
        // The payload is temporary, and is parsed immediately.
        /* clone= */ false);
    this.systemIds.push(shaka.util.Uint8ArrayUtils.toHex(systemIdData));
  }

  /**
   * Creates a pssh blob from the given system ID, data, keyIds and version.
   *
   * @param {!Uint8Array} data
   * @param {!Uint8Array} systemId
   * @param {!Set<string>} keyIds
   * @param {number} version
   * @return {!Uint8Array}
   */
  static createPssh(data, systemId, keyIds, version) {
    goog.asserts.assert(systemId.byteLength == 16, 'Invalid system ID length');
    const dataLength = data.length;
    let psshSize = 0x4 + 0x4 + 0x4 + systemId.length + 0x4 + dataLength;
    if (version > 0) {
      psshSize += 0x4 + (16 * keyIds.size);
    }

    /** @type {!Uint8Array} */
    const psshBox = new Uint8Array(psshSize);
    /** @type {!DataView} */
    const psshData = shaka.util.BufferUtils.toDataView(psshBox);

    let byteCursor = 0;
    psshData.setUint32(byteCursor, psshSize);
    byteCursor += 0x4;
    psshData.setUint32(byteCursor, 0x70737368);  // 'pssh'
    byteCursor += 0x4;
    (version < 1) ? psshData.setUint32(byteCursor, 0) :
        psshData.setUint32(byteCursor, 0x01000000); // version + flags
    byteCursor += 0x4;
    psshBox.set(systemId, byteCursor);
    byteCursor += systemId.length;

    // if version > 0, add KID count and kid values.
    if (version > 0) {
      psshData.setUint32(byteCursor, keyIds.size); // KID_count
      byteCursor += 0x4;
      const Uint8ArrayUtils = shaka.util.Uint8ArrayUtils;
      for (const keyId of keyIds) {
        const KID = Uint8ArrayUtils.fromHex(keyId);
        psshBox.set(KID, byteCursor);
        byteCursor += KID.length;
      }
    }

    psshData.setUint32(byteCursor, dataLength);
    byteCursor += 0x4;
    psshBox.set(data, byteCursor);
    byteCursor += dataLength;

    goog.asserts.assert(byteCursor === psshSize, 'PSSH invalid length.');
    return psshBox;
  }

  /**
   * Returns just the data portion of a single PSSH
   *
   * @param {!Uint8Array} pssh
   * @return {!Uint8Array}
   */
  static getPsshData(pssh) {
    let offset = 8; // Box size and type fields

    /** @type {!DataView} */
    const view = shaka.util.BufferUtils.toDataView(pssh);

    // Read version
    const version = view.getUint8(offset);

    // Version (1), flags (3), system ID (16)
    offset += 20;

    if (version > 0) {
      // Key ID count (4) and All key IDs (16*count)
      offset += 4 + (16 * view.getUint32(offset));
    }

    // Data size
    offset += 4;

    return shaka.util.BufferUtils.toUint8(view, offset);
  }

  /**
   * Normalise the initData array. This is to apply browser specific
   * workarounds, e.g. removing duplicates which appears to occur
   * intermittently when the native msneedkey event fires (i.e. event.initData
   * contains dupes).
   *
   * @param {!Uint8Array} initData
   * @return {!Uint8Array}
   */
  static normaliseInitData(initData) {
    if (!initData) {
      return initData;
    }

    const pssh = new shaka.util.Pssh(initData);

    // If there is only a single pssh, return the original array.
    if (pssh.data.length <= 1) {
      return initData;
    }

    // Dedupe psshData.
    /** @type {!Array<!Uint8Array>} */
    const dedupedInitDatas = [];
    for (const initData of pssh.data) {
      const found = dedupedInitDatas.some((x) => {
        return shaka.util.BufferUtils.equal(x, initData);
      });

      if (!found) {
        dedupedInitDatas.push(initData);
      }
    }

    return shaka.util.Uint8ArrayUtils.concat(...dedupedInitDatas);
  }
};

