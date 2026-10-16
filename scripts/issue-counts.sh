#!/usr/bin/env bash
# Prints open / in-progress / fixed counts per category from docs/KNOWN_ISSUES.md,
# so docs/PROGRESS.md never drifts from the source of truth.
set -euo pipefail
file="$(dirname "$0")/../docs/KNOWN_ISSUES.md"
count() { grep -cE "^\| $1-[0-9]+ +\| $2" "$file" || true; }
printf "%-6s %5s %12s %6s\n" "" open in-progress fixed
for category in SEC BUG DEBT; do
  printf "%-6s %5s %12s %6s\n" "$category" "$(count "$category" 🔴)" "$(count "$category" 🟡)" "$(count "$category" ✅)"
done
