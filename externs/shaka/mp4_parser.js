/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/**
 * @externs
 */


/**
 * The reader API available to MP4 box parsing callbacks.
 *
 * This describes the surface that shaka.util.DataViewReader exposes.  It is
 * declared here, rather than referring to shaka.util.DataViewReader directly,
 * so that these externs do not depend on the library.
 *
 * @interface
 * @exportDoc
 */
shaka.extern.DataViewReader = class {
  /**
   * @return {boolean} True if the reader has more data, false otherwise.
   * @exportDoc
   */
  hasMoreData() {}

  /**
   * Gets the current byte position.
   * @return {number}
   * @exportDoc
   */
  getPosition() {}

  /**
   * Gets the byte length of the DataView.
   * @return {number}
   * @exportDoc
   */
  getLength() {}

  /**
   * Reads an unsigned 8 bit integer, and advances the reader.
   * @return {number} The integer.
   * @exportDoc
   */
  readUint8() {}

  /**
   * Reads an unsigned 16 bit integer, and advances the reader.
   * @return {number} The integer.
   * @exportDoc
   */
  readUint16() {}

  /**
   * Reads an unsigned 32 bit integer, and advances the reader.
   * @return {number} The integer.
   * @exportDoc
   */
  readUint32() {}

  /**
   * Reads a signed 32 bit integer, and advances the reader.
   * @return {number} The integer.
   * @exportDoc
   */
  readInt32() {}

  /**
   * Reads an unsigned 64 bit integer, and advances the reader.
   * @return {number} The integer.
   * @exportDoc
   */
  readUint64() {}

  /**
   * Reads the specified number of raw bytes.
   * @param {number} bytes The number of bytes to read.
   * @param {boolean} clone True to clone the data into a new buffer, false to
   *   create a view on the existing buffer.  Creating a view on the existing
   *   buffer will keep the entire buffer in memory so long as the view is
   *   reachable.  Use false for temporary values, and true for values that
   *   need to outlive the underlying buffer.
   * @return {!Uint8Array}
   * @exportDoc
   */
  readBytes(bytes, clone) {}

  /**
   * Skips the specified number of bytes.
   * @param {number} bytes The number of bytes to skip.
   * @return {void}
   * @exportDoc
   */
  skip(bytes) {}

  /**
   * Rewinds the specified number of bytes.
   * @param {number} bytes The number of bytes to rewind.
   * @return {void}
   * @exportDoc
   */
  rewind(bytes) {}

  /**
   * Seeks to a specified position.
   * @param {number} position The desired byte position within the DataView.
   * @return {void}
   * @exportDoc
   */
  seek(position) {}

  /**
   * Keeps reading until it reaches a byte that equals to zero.  The text is
   * assumed to be UTF-8.
   * @return {string}
   * @exportDoc
   */
  readTerminatedString() {}
};


/**
 * The MP4 parser API available to box parsing callbacks.
 *
 * This describes the surface that shaka.util.Mp4Parser exposes to the
 * callbacks it invokes.  It is declared here, rather than referring to
 * shaka.util.Mp4Parser directly, so that these externs do not depend on the
 * library.
 *
 * @interface
 * @exportDoc
 */
shaka.extern.Mp4Parser = class {
  /**
   * Declare a box type as a Box.
   * @param {string} type
   * @param {function(!shaka.extern.ParsedBox)} definition
   * @return {!shaka.extern.Mp4Parser}
   * @exportDoc
   */
  box(type, definition) {}

  /**
   * Declare multiple box types as Basic Boxes.
   * @param {!Array<string>} types
   * @param {function(!shaka.extern.ParsedBox)} definition
   * @return {!shaka.extern.Mp4Parser}
   * @exportDoc
   */
  boxes(types, definition) {}

  /**
   * Declare a box type as a Full Box.
   * @param {string} type
   * @param {function(!shaka.extern.ParsedBox)} definition
   * @return {!shaka.extern.Mp4Parser}
   * @exportDoc
   */
  fullBox(type, definition) {}

  /**
   * Declare multiple box types as Full Boxes.
   * @param {!Array<string>} types
   * @param {function(!shaka.extern.ParsedBox)} definition
   * @return {!shaka.extern.Mp4Parser}
   * @exportDoc
   */
  fullBoxes(types, definition) {}

  /**
   * Stop parsing.  Useful for extracting information from partial segments and
   * avoiding an out-of-bounds error once you find what you are looking for.
   * @return {void}
   * @exportDoc
   */
  stop() {}

  /**
   * Parse the given data using the added callbacks.
   * @param {!BufferSource} data
   * @param {boolean=} partialOkay If true, allow reading partial payloads
   *   from some boxes. If the goal is a child box, we can sometimes find it
   *   without enough data to find all child boxes.
   * @param {boolean=} stopOnPartial If true, stop reading if an incomplete
   *   box is detected.
   * @return {void}
   * @exportDoc
   */
  parse(data, partialOkay, stopOnPartial) {}

  /**
   * Parse the next box on the current level.
   * @param {number} absStart The absolute start position in the original
   *   byte array.
   * @param {!shaka.extern.DataViewReader} reader
   * @param {boolean=} partialOkay If true, allow reading partial payloads
   *   from some boxes. If the goal is a child box, we can sometimes find it
   *   without enough data to find all child boxes.
   * @param {boolean=} stopOnPartial If true, stop reading if an incomplete
   *   box is detected.
   * @return {void}
   * @exportDoc
   */
  parseNext(absStart, reader, partialOkay, stopOnPartial) {}
};


/**
 * @typedef {{
 *    name: string,
 *    parser: !shaka.extern.Mp4Parser,
 *    partialOkay: boolean,
 *    stopOnPartial: boolean,
 *    start: number,
 *    size: number,
 *    version: ?number,
 *    flags: ?number,
 *    reader: !shaka.extern.DataViewReader,
 *    has64BitSize: boolean
 * }}
 *
 * @property {string} name
 *   The box name, a 4-character string (fourcc).
 * @property {!shaka.extern.Mp4Parser} parser
 *   The parser that parsed this box. The parser can be used to parse child
 *   boxes where the configuration of the current parser is needed to parsed
 *   other boxes.
 * @property {boolean} partialOkay
 *   If true, allows reading partial payloads from some boxes. If the goal is a
 *   child box, we can sometimes find it without enough data to find all child
 *   boxes. This property allows the partialOkay flag from parse() to be
 *   propagated through methods like children().
 * @property {boolean} stopOnPartial
 *   If true, stop reading if an incomplete box is detected.
 * @property {number} start
 *   The start of this box (before the header) in the original buffer. This
 *   start position is the absolute position.
 * @property {number} size
 *   The size of this box (including the header).
 * @property {?number} version
 *   The version for a full box, null for basic boxes.
 * @property {?number} flags
 *   The flags for a full box, null for basic boxes.
 * @property {!shaka.extern.DataViewReader} reader
 *   The reader for this box is only for this box. Reading or not reading to
 *   the end will have no affect on the parser reading other sibling boxes.
 * @property {boolean} has64BitSize
 *   If true, the box header had a 64-bit size field.  This affects the offsets
 *   of other fields.
 * @exportDoc
 */
shaka.extern.ParsedBox;
