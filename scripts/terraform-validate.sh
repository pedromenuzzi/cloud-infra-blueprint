#!/usr/bin/env bash
# Run `terraform init`, `validate` and `fmt -check` on every project directory
# under <root> (as written by templates:emit / emit-catalog.ts). Any validate
# diagnostic — warnings and deprecations included — fails the run.
#
#   bash scripts/terraform-validate.sh .tf-templates
#
# TERRAFORM overrides the binary; set TF_PLUGIN_CACHE_DIR to reuse downloads.
set -uo pipefail

root="${1:?usage: terraform-validate.sh <dir-of-projects>}"
tf="${TERRAFORM:-terraform}"
status=0

for dir in "$root"/*/; do
  name="$(basename "$dir")"
  if ! init_log="$("$tf" -chdir="$dir" init -backend=false -input=false -no-color 2>&1)"; then
    printf '%s: terraform init failed\n%s\n' "$name" "$init_log"
    status=1
    continue
  fi
  result="$("$tf" -chdir="$dir" validate -json -no-color)"
  count="$(jq '.diagnostics | length' <<<"$result")"
  if [ "$count" != "0" ]; then
    printf '%s: %s diagnostic(s)\n' "$name" "$count"
    jq -r '.diagnostics[] | "  \(.severity): \(.summary) — \((.detail // "") | gsub("\n"; " ")) [\(.range.filename // "?"):\(.range.start.line // "?")]"' <<<"$result"
    status=1
  else
    printf '%s: valid\n' "$name"
  fi
done

if ! "$tf" fmt -check -recursive -diff "$root"; then
  printf 'terraform fmt: the files above are not formatted\n'
  status=1
fi

exit "$status"
