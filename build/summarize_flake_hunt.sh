#!/bin/bash
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

# Summarize a flake hunt log: how many runs failed, and which specs failed.
#
# Given the number of runs that were asked for, this also fails when fewer than
# that finished.  A hunt cut short reports a rate over a sample it did not
# take, and looks exactly like a clean one, so it has to be an error rather
# than a line in the output that is easy to read past.
#
# Usage: summarize_flake_hunt.sh <log-file> [label] [expected-runs]

set -u
LOG="${1:?usage: summarize_flake_hunt.sh <log-file> [label] [expected-runs]}"
LABEL="${2:-flake hunt}"
EXPECTED="${3:-0}"

if [ ! -f "$LOG" ]; then
  echo "No log at $LOG"
  exit 0
fi

# test.py prints its own tally once the whole loop is done, and that is the
# authoritative one: it counts runs it actually performed.  Its absence is what
# says a hunt was cut short, since the line is only reached after the last run.
#
# Karma's per-run TOTAL lines are the fallback, but they undercount.  Five runs
# out of sixty produced none in a hunt with IndexedDB tracing on, where the
# console dumps are large enough to disturb Karma's own summary, and every one
# of those runs had in fact completed.
TALLY=$(grep -a "All runs completed" "$LOG" | tail -1 || true)

if [ -n "$TALLY" ]; then
  passed=$(echo "$TALLY" | sed -E 's|.*completed\. *([0-9]+) */ *([0-9]+).*|\1|')
  total=$(echo "$TALLY" | sed -E 's|.*completed\. *([0-9]+) */ *([0-9]+).*|\2|')
  failed=$((total - passed))
else
  total=$(grep -ac "^.*TOTAL:" "$LOG" || true)
  failed=$(grep -ac "^.*TOTAL:.*FAILED" "$LOG" || true)
fi

echo "=== $LABEL"
echo "runs_finished=$total"
echo "runs_failed=$failed"

TRUNCATED=""
if [ "$EXPECTED" -gt 0 ] && [ -z "$TALLY" ]; then
  TRUNCATED="only $total of $EXPECTED runs finished"
  echo "runs_expected=$EXPECTED"
  echo "::error::Flake hunt truncated: $TRUNCATED.  Any rate from this log is"\
       "measured over a sample that was never taken.  Raise timeout_minutes,"\
       "or ask for fewer runs."
fi

# Strip color and the trailing "[Browser (OS)]" tag from each failing spec, so
# the same spec failing in different runs groups together.  Karma writes a real
# escape byte locally; the Actions log API rewrites it as a literal caret.
SPECS=$(grep -a '✗' "$LOG" |
  perl -ne 'chomp;
            s/(?:\e|\^)\[\[?[0-9;]*m//g;
            next unless s/^.*?✗\s*//;
            s/\s*\[[^][]*\]\s*$//;
            s/^\s+|\s+$//g;
            print "$_\n" if length' |
  sort | uniq -c | sort -rn)

if [ -n "$SPECS" ]; then
  echo "failing specs (count, name):"
  echo "$SPECS"
fi

# Also surface test.py's own tally, which is authoritative for runs that ended.
grep -a "All runs completed" "$LOG" || true

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### $LABEL"
    echo ""
    if [ -n "$TRUNCATED" ]; then
      echo "**TRUNCATED: $TRUNCATED.**  These numbers are not a rate."
      echo ""
    fi
    echo "| runs finished | runs failed |"
    echo "| --- | --- |"
    echo "| $total | $failed |"
    if [ -n "$SPECS" ]; then
      echo ""
      echo "| count | failing spec |"
      echo "| --- | --- |"
      echo "$SPECS" | sed -E 's/^ *([0-9]+) (.*)$/| \1 | \2 |/'
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

# Fail the job on a short sample.  The hunt step itself runs with
# continue-on-error, since failing runs are what it is looking for, so this is
# the only place a truncated hunt can be caught.
if [ -n "$TRUNCATED" ]; then
  exit 1
fi
