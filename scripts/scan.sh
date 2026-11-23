#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# The security scan: semgrep, betterleaks (the working tree and the whole git history),
# osv-scanner, trivy, the license allowlist, the notices file and npm audit. Every step runs, and the script fails
# if any of them did. The scanner versions are pinned in mise.toml.
set -uo pipefail
cd "$(dirname "$0")/.."

failed=()
step() {
  local name="$1"
  shift
  echo
  echo "== ${name}"
  if ! "$@"; then failed+=("${name}"); fi
}
need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "${1} is not on PATH. Run \`mise install\` in this folder, or install ${1} yourself." >&2
  return 1
}

semgrep_scan() {
  need semgrep || return 1
  semgrep scan --metrics=off --error --quiet \
    --config p/typescript --config p/javascript --config p/react --config p/nodejs \
    --config p/secrets --config p/owasp-top-ten --config p/security-audit --config p/github-actions \
    .
}
leaks_history() {
  need betterleaks || return 1
  betterleaks git --no-banner --redact=100 --log-opts="--all" .
}
# The working tree means every file git tracks or would track. Folders that .gitignore names are
# left out: after a deploy, cdk.out holds bundled third-party code that reads as secrets, and
# nothing in an ignored folder can be committed. The history scan covers what was committed.
leaks_tree() {
  need betterleaks || return 1
  local files=() file
  while IFS= read -r -d '' file; do
    [[ -e "${file}" ]] && files+=("${file}")
  done < <(git ls-files -z --cached --others --exclude-standard)
  if ((${#files[@]} == 0)); then
    echo "no files to scan: is this a git repository?" >&2
    return 1
  fi
  betterleaks dir --no-banner --redact=100 "${files[@]}"
}
osv() {
  need osv-scanner || return 1
  osv-scanner scan source --config osv-scanner.toml --lockfile package-lock.json
}
trivy_fs() {
  need trivy || return 1
  trivy fs --quiet --scanners vuln,secret,misconfig --severity MEDIUM,HIGH,CRITICAL --exit-code 1 \
    --ignorefile .trivyignore.yaml \
    --skip-dirs node_modules --skip-dirs cdk.out --skip-dirs 'dist*' --skip-dirs .cdk-blocks/local \
    .
}

step "semgrep" semgrep_scan
step "betterleaks, git history" leaks_history
step "betterleaks, working tree" leaks_tree
step "osv-scanner" osv
step "trivy fs" trivy_fs
step "licenses" npm run --silent licenses
# Two checks that see what the steps above can miss: a production package with no entry in
# THIRD-PARTY-LICENSES, and an advisory in a copy bundled inside another package.
step "license notices" node scripts/third-party-licenses.mjs --check
step "npm audit" npm audit --audit-level=high

echo
if ((${#failed[@]})); then
  echo "scan: failed: ${failed[*]}"
  exit 1
fi
echo "scan: all steps passed"
