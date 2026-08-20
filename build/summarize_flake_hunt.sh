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
# Usage: summarize_flake_hunt.sh <log-file> [label]

set -u
LOG="${1:?usage: summarize_flake_hunt.sh <log-file> [label]}"
LABEL="${2:-flake hunt}"

if [ ! -f "$LOG" ]; then
  echo "No log at $LOG"
  exit 0
fi

# Karma prints one TOTAL line per run, so counting them counts the runs that
# reached an end.  A run that crashes or disconnects prints none, which is why
# this is compared against the requested count rather than trusted outright.
total=$(grep -ac "^.*TOTAL:" "$LOG" || true)
failed=$(grep -ac "^.*TOTAL:.*FAILED" "$LOG" || true)

echo "=== $LABEL"
echo "runs_finished=$total"
echo "runs_failed=$failed"

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
