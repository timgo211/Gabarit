#!/bin/bash
# Hook Stop : avant que Claude termine, relance les tests si du code a changé.
# Sortie 2 = Claude est renvoyé corriger (les échecs lui sont transmis sur stderr).
cd "$CLAUDE_PROJECT_DIR" || exit 0
PATHS="src tests tools sw.js index.html"
changed=$(git status --porcelain -- $PATHS 2>/dev/null)
if [ -z "$changed" ] && git rev-parse -q --verify origin/main >/dev/null; then
  git diff --quiet origin/main...HEAD -- $PATHS 2>/dev/null && exit 0
elif [ -z "$changed" ]; then
  exit 0
fi
out=$(node --test 2>&1) || { echo "Tests en échec (node --test) :" >&2; echo "$out" | grep -E '^not ok|^# (pass|fail)|Error|expected|actual' | head -40 >&2; exit 2; }
exit 0
