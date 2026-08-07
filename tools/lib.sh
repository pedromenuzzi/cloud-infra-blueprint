#!/usr/bin/env bash
# Linux Dojo — checker helper library.
# Deliberately bash 3.2-safe (works on stock macOS bash): no associative
# arrays, no mapfile, no ${var,,}. Artifact-based checks only — we inspect the
# files you produced, never your host's OS internals, so results are identical
# on macOS and Linux.

# ---- terminal colors (disabled when not a TTY or NO_COLOR set) --------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RST=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_MAG=$'\033[35m'; C_CYN=$'\033[36m'
else
  C_RST=""; C_DIM=""; C_BOLD=""; C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_MAG=""; C_CYN=""
fi

# LC_ALL=C makes sort/cmp/grep deterministic regardless of the user's locale.
export LC_ALL=C

# ---- per-mission result state ----------------------------------------------
CHK_FAILS=0
CHK_PASS=0
CHK_MSGS=""

_check_reset() { CHK_FAILS=0; CHK_PASS=0; CHK_MSGS=""; }

_ok() {
  CHK_PASS=$((CHK_PASS + 1))
  if [ -n "${VERBOSE:-}" ]; then printf "    ${C_GRN}✓${C_RST} %s\n" "$1"; fi
  return 0
}

_bad() {
  CHK_FAILS=$((CHK_FAILS + 1))
  CHK_MSGS="${CHK_MSGS}
    ${C_RED}✗${C_RST} $1"
  if [ -n "${VERBOSE:-}" ]; then printf "    ${C_RED}✗${C_RST} %s\n" "$1"; fi
  return 1
}

# ---- small utilities --------------------------------------------------------

# echo the first-line-collapsed, trimmed, lowercased normalization of a file
_norm_oneline() {
  # collapse all whitespace to single spaces, trim ends, lowercase
  [ -f "$1" ] || return 0
  tr '\n' ' ' < "$1" 2>/dev/null | tr -s '[:space:]' ' ' \
    | sed 's/^ *//; s/ *$//' | tr 'A-Z' 'a-z'
}

_line_count() { [ -f "$1" ] || { echo 0; return; }; wc -l < "$1" 2>/dev/null | tr -d ' '; }

# Convert a path's permission bits to a 3-digit octal string via `ls -ld`
# (portable: no stat -c/-f differences). Prints e.g. 640, 755.
perm_octal() {
  local perms
  perms=$(ls -ld "$1" 2>/dev/null | awk '{print $1}')
  [ -n "$perms" ] || return 1
  perms=${perms#?}          # drop the leading type char (- d l ...)
  perms=${perms:0:9}        # keep the 9 permission characters
  [ ${#perms} -eq 9 ] || return 1
  local o="" i c val
  for i in 0 3 6; do
    val=0
    c=${perms:$i:1};        [ "$c" = "r" ] && val=$((val + 4))
    c=${perms:$((i+1)):1};  [ "$c" = "w" ] && val=$((val + 2))
    c=${perms:$((i+2)):1};  case "$c" in x|s|t|S|T) val=$((val + 1));; esac
    o="${o}${val}"
  done
  printf '%s' "$o"
}

# Extract the value of KEY from a key=value file. Tolerant of: spaces around
# '=', leading list markers (- * >), backticks, and trailing CR/whitespace.
kv_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  awk -v k="$key" '
    {
      line = $0
      gsub(/\r/, "", line)
      idx = index(line, "=")
      if (idx > 0) {
        lk = substr(line, 1, idx - 1)
        lv = substr(line, idx + 1)
        gsub(/`/, "", lk); gsub(/`/, "", lv)
        gsub(/^[-*> \t]+/, "", lk)
        gsub(/[ \t]+$/, "", lk)
        gsub(/^[ \t]+/, "", lv); gsub(/[ \t]+$/, "", lv)
        if (lk == k) val = lv
      }
    }
    END { if (val != "") print val }
  ' "$file"
}

# ---- requirement primitives -------------------------------------------------
# Each prints nothing on success (unless VERBOSE), records a message on failure.

req_file() { # req_file PATH [label]
  if [ -f "$1" ]; then _ok "${2:-file $1} exists"; else _bad "${2:-file \`$1\`} is missing"; fi
}
req_dir() {
  if [ -d "$1" ]; then _ok "${2:-directory $1} exists"; else _bad "${2:-directory \`$1\`} is missing"; fi
}
req_absent() { # path must NOT exist
  if [ -e "$1" ] || [ -L "$1" ]; then _bad "${2:-\`$1\`} should have been removed but still exists"; else _ok "${2:-$1} is gone"; fi
}
req_nonempty() {
  if [ -s "$1" ]; then _ok "${2:-$1} is non-empty"; else _bad "${2:-\`$1\`} is missing or empty"; fi
}
req_symlink_to() { # req_symlink_to LINK EXPECTED_TARGET_SUBSTR
  local tgt
  if [ ! -L "$1" ]; then _bad "\`$1\` should be a symlink"; return; fi
  tgt=$(readlink "$1" 2>/dev/null)
  if printf '%s' "$tgt" | grep -q "$2"; then
    if [ -e "$1" ]; then _ok "$1 → $tgt (resolves)"; else _bad "\`$1\` → $tgt but the target does not exist (still dangling)"; fi
  else
    _bad "\`$1\` should point at something containing '$2' (points at '${tgt:-nothing}')"
  fi
}

req_grep() { # req_grep PATH PATTERN [label]  (fixed-string, case-sensitive)
  if [ -f "$1" ] && grep -qF -- "$2" "$1" 2>/dev/null; then _ok "${3:-$1 contains '$2'}"; else _bad "${3:-\`$1\` should contain '$2'}"; fi
}
req_igrep() { # case-insensitive fixed-string
  if [ -f "$1" ] && grep -qiF -- "$2" "$1" 2>/dev/null; then _ok "${3:-$1 contains '$2'}"; else _bad "${3:-\`$1\` should contain '$2' (any case)}"; fi
}
req_egrep() { # extended regex
  if [ -f "$1" ] && grep -qE -- "$2" "$1" 2>/dev/null; then _ok "${3:-$1 matches /$2/}"; else _bad "${3:-\`$1\` should match /$2/}"; fi
}
req_not_grep() { # PATH must NOT contain PATTERN (fixed string)
  if [ -f "$1" ] && grep -qF -- "$2" "$1" 2>/dev/null; then _bad "${3:-\`$1\` should NOT contain '$2'}"; else _ok "${3:-$1 is free of '$2'}"; fi
}
req_not_egrep() {
  if [ -f "$1" ] && grep -qE -- "$2" "$1" 2>/dev/null; then _bad "${3:-\`$1\` should NOT match /$2/}"; else _ok "${3:-$1 free of /$2/}"; fi
}

req_count() { # req_count PATH N [label]  — exact line count
  local n; n=$(_line_count "$1")
  if [ "${n:-x}" = "$2" ]; then _ok "${3:-$1 has $2 lines}"; else _bad "${3:-\`$1\` should have $2 lines (has ${n:-0})}"; fi
}
req_count_min() {
  local n; n=$(_line_count "$1")
  if [ -n "$n" ] && [ "$n" -ge "$2" ] 2>/dev/null; then _ok "${3:-$1 has ≥$2 lines}"; else _bad "${3:-\`$1\` should have at least $2 lines (has ${n:-0})}"; fi
}

req_mode() { # req_mode PATH OCTAL
  local got; got=$(perm_octal "$1")
  if [ "$got" = "$2" ]; then _ok "$(basename "$1") is mode $2"; else _bad "\`$(basename "$1")\` should be mode $2 (is ${got:-missing})"; fi
}
req_exec() {
  if [ -x "$1" ]; then _ok "$(basename "$1") is executable"; else _bad "\`$(basename "$1")\` must be executable (chmod +x)"; fi
}

# compare a produced file to an expected computed string (whole-file, exact)
req_file_eq_cmd() { # req_file_eq_cmd PATH EXPECTED_STRING [label]
  if [ ! -f "$1" ]; then _bad "${3:-\`$1\`} is missing"; return; fi
  local got; got=$(cat "$1")
  if [ "$got" = "$2" ]; then _ok "${3:-$1 matches expected}"; else _bad "${3:-\`$1\` content does not match what the commands should produce}"; fi
}

# whole-file normalized (trim/collapse/lowercase) equals expected
req_oneline_eq() { # req_oneline_eq PATH EXPECTED [label]
  if [ ! -f "$1" ]; then _bad "${3:-\`$1\`} is missing"; return; fi
  local got want
  got=$(_norm_oneline "$1")
  want=$(printf '%s' "$2" | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//' | tr 'A-Z' 'a-z')
  if [ "$got" = "$want" ]; then _ok "${3:-$1 == '$2'}"; else _bad "${3:-\`$1\` should be '$2' (found '${got}')}"; fi
}

# ---- answers.md (key=value) primitives -------------------------------------
req_kv() { # exact (trimmed) value, case-insensitive
  local got; got=$(kv_get "$1" "$2" | tr 'A-Z' 'a-z')
  local want; want=$(printf '%s' "$3" | tr 'A-Z' 'a-z')
  if [ "$got" = "$want" ]; then _ok "$2 = $3"; else _bad "$2 should be '$3' (found '${got:-<missing>}')"; fi
}
req_kv_has() { # value CONTAINS substring, case-insensitive
  local got; got=$(kv_get "$1" "$2" | tr 'A-Z' 'a-z')
  local want; want=$(printf '%s' "$3" | tr 'A-Z' 'a-z')
  if printf '%s' "$got" | grep -qF -- "$want"; then _ok "$2 → $3"; else _bad "$2 should contain '$3' (found '${got:-<missing>}')"; fi
}
req_kv_num() { # first integer in value equals N
  local got num; got=$(kv_get "$1" "$2"); num=$(printf '%s' "$got" | grep -oE '[0-9]+' | head -1)
  if [ "${num:-x}" = "$3" ]; then _ok "$2 = $3"; else _bad "$2 should be $3 (found '${got:-<missing>}')"; fi
}
req_kv_any() { # value matches ANY of the remaining args (contains, ci)
  local file="$1" key="$2"; shift 2
  local got; got=$(kv_get "$file" "$key" | tr 'A-Z' 'a-z')
  local cand hit=""
  for cand in "$@"; do
    cand=$(printf '%s' "$cand" | tr 'A-Z' 'a-z')
    if printf '%s' "$got" | grep -qF -- "$cand"; then hit="$cand"; break; fi
  done
  if [ -n "$hit" ]; then _ok "$key → $hit"; else _bad "$key should be one of [$*] (found '${got:-<missing>}')"; fi
}
req_kv_present() { # value exists and is at least MINLEN chars (default 3)
  local got; got=$(kv_get "$1" "$2"); local minl="${3:-3}"
  if [ -n "$got" ] && [ "${#got}" -ge "$minl" ]; then _ok "$2 is filled in"; else _bad "$2 needs a real answer (at least $minl chars)"; fi
}

# ---- timeout-guarded runner -------------------------------------------------
# run_cap SECS CMD [ARGS...]  → sets RUN_OUT, RUN_ERR, RUN_RC. Kills runaways.
RUN_OUT=""; RUN_ERR=""; RUN_RC=0
run_cap() {
  local secs="$1"; shift
  local of ef
  of=$(mktemp 2>/dev/null || printf '/tmp/dojo.out.%s' "$$")
  ef=$(mktemp 2>/dev/null || printf '/tmp/dojo.err.%s' "$$")
  ( "$@" ) >"$of" 2>"$ef" &
  local pid=$!
  ( sleep "$secs"; kill -9 "$pid" >/dev/null 2>&1 ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid" 2>/dev/null; RUN_RC=$?
  kill "$watcher" >/dev/null 2>&1; wait "$watcher" 2>/dev/null
  RUN_OUT=$(cat "$of" 2>/dev/null)
  RUN_ERR=$(cat "$ef" 2>/dev/null)
  rm -f "$of" "$ef"
}
