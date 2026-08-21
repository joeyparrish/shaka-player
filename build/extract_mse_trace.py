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

"""Reassemble MSE traces from a test log, and line two of them up.

The tracer installed by test.py --mse-trace reports through the browser
console, which Karma wraps in quoting and ANSI color and which the tracer
splits across many CHUNK lines.  This puts the pieces back together, and can
also print a passing trace beside a failing one so the point where they stop
agreeing is easy to find.

Usage:
  build/extract_mse_trace.py <log-file>            # every trace, as JSON
  build/extract_mse_trace.py <log-file> --list     # one line per trace
  build/extract_mse_trace.py <log-file> --diff     # pass vs fail, side by side
"""

import json
import re
import sys


CHUNK_RE = re.compile(
    r'\[mse-trace\] CHUNK ([0-9a-z]{4,12}) (\d+)/(\d+) (\[.*\])')
SUMMARY_RE = re.compile(r'\[mse-trace\] SUMMARY ([0-9a-z]{4,12}) (\{.*\})')
BEGIN_RE = re.compile(r'\[mse-trace\] BEGIN session=([0-9a-z]{4,12})')


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
  """Pull traces out of a log file.

  A single browser session dumps one trace per spec that touched media, so
  records are grouped by the BEGIN line that precedes them rather than by
  session alone.

  Args:
    path: Path to the log file.
  Returns:
    A list of traces, each a dict of session, summary, and records.
  """
  traces = []
  current = None

  with open(path, 'r', errors='replace') as f:
    for line in f:
      match = SUMMARY_RE.search(line)
      if match:
        blob = strip_tail(match.group(2), '}')
        try:
          summary = json.loads(blob)
        except json.JSONDecodeError as e:
          print('Skipping malformed summary: %s' % e, file=sys.stderr)
          continue
        current = {
            'session': match.group(1),
            'summary': summary,
            'records': [],
        }
        traces.append(current)
        continue

      match = CHUNK_RE.search(line)
      if not match or current is None:
        continue

      try:
        chunk = json.loads(strip_tail(match.group(4), ']'))
      except json.JSONDecodeError as e:
        print('Skipping malformed chunk %s: %s' % (match.group(2), e),
              file=sys.stderr)
        continue
      current['records'].extend(chunk)

  return traces


def describe(record):
  """Render one record as a single comparable line.

  Sequence numbers and timestamps are left out on purpose: they differ between
  any two runs and would make every line look like a difference.

  Args:
    record: One trace record.
  Returns:
    A string describing the record.
  """
  parts = [record.get('op', '?')]
  for key in ('sb', 'el', 'value', 'start', 'end', 'bytes', 'type',
              'currentTime', 'readyState', 'seeking', 'paused', 'updating',
              'buffered', 'threw'):
    if key in record:
      parts.append('%s=%s' % (key, json.dumps(record[key])))
  return ' '.join(parts)


def summarize(trace):
  """Return a one-line description of a trace."""
  summary = trace['summary']
  reason = summary.get('reason', '')
  return '%s  records=%d  %s' % (
      trace['session'], len(trace['records']), reason)


def print_diff(traces):
  """Print a passing trace beside a failing one.

  Args:
    traces: All traces found in the log.
  Returns:
    0 if a pair was found and printed, 1 otherwise.
  """
  passed = [t for t in traces if 'passed' in t['summary'].get('reason', '')]
  failed = [t for t in traces if 'failed' in t['summary'].get('reason', '')]

  if not passed or not failed:
    print('Need at least one passing and one failing trace; found %d and %d.'
          % (len(passed), len(failed)), file=sys.stderr)
    return 1

  # Compare the last passing run against the first failing one.  Any pair would
  # do, but a stall is more likely to differ from a healthy run than two
  # healthy runs are to differ from each other.
  left = [describe(r) for r in passed[-1]['records']]
  right = [describe(r) for r in failed[0]['records']]

  print('# pass: %s' % summarize(passed[-1]))
  print('# fail: %s' % summarize(failed[0]))
  print()

  limit = max(len(left), len(right))
  diverged = False
  for i in range(limit):
    a = left[i] if i < len(left) else ''
    b = right[i] if i < len(right) else ''
    if a == b and not diverged:
      continue
    if not diverged:
      diverged = True
      print('# first difference at index %d' % i)
    print('%5d  P  %s' % (i, a))
    print('%5d  F  %s' % (i, b))

  if not diverged:
    print('# traces agree for all %d records' % limit)
  return 0


def main():
  if len(sys.argv) < 2:
    print(__doc__, file=sys.stderr)
    return 1

  traces = extract(sys.argv[1])

  if '--list' in sys.argv:
    for trace in traces:
      print(summarize(trace))
    return 0

  if '--diff' in sys.argv:
    return print_diff(traces)

  json.dump(traces, sys.stdout, indent=2)
  print()
  print('%d traces' % len(traces), file=sys.stderr)
  return 0


if __name__ == '__main__':
  sys.exit(main())
