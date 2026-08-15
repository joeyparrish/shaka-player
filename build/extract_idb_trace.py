#!/usr/bin/env python3
#
# Copyright 2016 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Reassemble an IndexedDB trace from a test log into a single JSON array.

The tracer installed by test.py --idb-trace reports through the browser
console, which Karma wraps in quoting and ANSI color and which the tracer
splits across many CHUNK lines.  This puts the pieces back together.

Usage:
  build/extract_idb_trace.py <log-file>              # full trace as JSON
  build/extract_idb_trace.py <log-file> --summary    # just the summaries
"""

import json
import re
import sys


CHUNK_RE = re.compile(r'\[idb-trace\] CHUNK (\d+)/(\d+) (\[.*\])')
SUMMARY_RE = re.compile(r'\[idb-trace\] SUMMARY (\{.*\})')


def strip_tail(text, closer):
  """Trim trailing ANSI escapes and Karma's closing quote from a JSON blob.

  Karma emits a real escape byte when run locally, but the GitHub Actions log
  API returns a literal caret-bracket instead, so handle both forms.

  Args:
    text: The captured text, which may have trailing junk.
    closer: The character the JSON value should end with.
  Returns:
    The text truncated to end at the last |closer|.
  """
  text = re.sub(r'(?:\x1b|\^)\[[0-9;]*m', '', text).rstrip()
  while text and not text.endswith(closer):
    text = text[:-1]
  return text


def extract(path):
  """Pull trace records and summaries out of a log file.

  Args:
    path: Path to the log file.
  Returns:
    A tuple of (records, summaries).
  """
  # A run dumps once when the watchdog spots a hang and again when it ends, so
  # the same record can appear twice.  Key by sequence number and keep the last
  # copy seen, which reflects the operation's final state.
  by_seq = {}
  extras = []
  summaries = []

  with open(path, 'r', errors='replace') as f:
    for line in f:
      match = SUMMARY_RE.search(line)
      if match:
        blob = strip_tail(match.group(1), '}')
        try:
          summaries.append(json.loads(blob))
        except json.JSONDecodeError as e:
          print('Skipping malformed summary: %s' % e, file=sys.stderr)
        continue

      match = CHUNK_RE.search(line)
      if not match:
        continue

      index = int(match.group(1))
      try:
        chunk = json.loads(strip_tail(match.group(3), ']'))
      except json.JSONDecodeError as e:
        print('Skipping malformed chunk %d: %s' % (index, e), file=sys.stderr)
        continue

      for record in chunk:
        if 'seq' in record:
          by_seq[record['seq']] = record
        else:
          extras.append(record)

  records = sorted(by_seq.values(), key=lambda r: r['seq']) + extras
  return records, summaries


def main():
  if len(sys.argv) < 2:
    print(__doc__, file=sys.stderr)
    return 1

  records, summaries = extract(sys.argv[1])
  want_summary = '--summary' in sys.argv

  json.dump(summaries if want_summary else records, sys.stdout, indent=2)
  print()
  print('%d records, %d summaries' % (len(records), len(summaries)),
        file=sys.stderr)
  return 0


if __name__ == '__main__':
  sys.exit(main())
