#!/usr/bin/env bash
# ============================================================
# Build & push claw-office to UCloud uhub registry.
#
# Steps (timed individually):
#   1. git push the current local commit to itai-claw/main
#   2. docker login to uhub.service.ucloud.cn
#   3. docker build from itai-claw/main (fresh clone via BuildKit git context)
#   4. docker push the tagged image
#
# Credentials are loaded from .env.ucloud (gitignored). See .env.ucloud.example
# for the template. Override anything via env vars, e.g.:
#   IMAGE_TAG=v0.0.2 ./scripts/build-and-push-ucloud.sh
#   GIT_BRANCH=feat/x ./scripts/build-and-push-ucloud.sh
#   SKIP_GIT_PUSH=1 ./scripts/build-and-push-ucloud.sh   # registry-only re-run
# ============================================================
set -euo pipefail

# ---------- Load credentials from .env.ucloud (if present) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_UCLOUD="${ENV_UCLOUD:-${REPO_ROOT}/.env.ucloud}"
if [ -f "${ENV_UCLOUD}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_UCLOUD}"
  set +a
fi

# ---------- Configuration ----------
GIT_REMOTE="${GIT_REMOTE:-itai-claw}"
GIT_BRANCH="${GIT_BRANCH:-main}"

REGISTRY="${REGISTRY:-uhub.service.ucloud.cn}"
REGISTRY_USER="${REGISTRY_USER:?REGISTRY_USER not set (define it in ${ENV_UCLOUD} or export it)}"
REGISTRY_PASS="${REGISTRY_PASS:?REGISTRY_PASS not set (define it in ${ENV_UCLOUD} or export it)}"
IMAGE_NAME="${IMAGE_NAME:-zrt-application/claw-office-o}"
IMAGE_TAG="${IMAGE_TAG:-v0.0.1}"
FULL_TAG="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

GIT_CONTEXT_URL="${GIT_CONTEXT_URL:-https://github.com/intelli-train-ai/claw-office.git#${GIT_BRANCH}}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
CLAUDE_CODE_VERSION="${CLAUDE_CODE_VERSION:-2.1.121}"

SKIP_GIT_PUSH="${SKIP_GIT_PUSH:-0}"

# ---------- Timer scaffolding ----------
declare -a STEP_NAMES=()
declare -a STEP_TIMES=()
SCRIPT_START=$(date +%s)

fmt_dur() {
  local s=$1
  printf "%dm %02ds" $((s / 60)) $((s % 60))
}

run_step() {
  local name="$1"; shift
  local start end elapsed status
  start=$(date +%s)
  echo
  echo ">>> [$(date +%H:%M:%S)] ${name}"
  echo "    \$ $*"
  echo "----------------------------------------"
  set +e
  "$@"
  status=$?
  set -e
  end=$(date +%s)
  elapsed=$((end - start))
  STEP_NAMES+=("$name")
  STEP_TIMES+=("$elapsed")
  if [ "$status" -ne 0 ]; then
    echo "----------------------------------------"
    echo "!!! ${name} FAILED after $(fmt_dur "$elapsed") (exit=$status)"
    print_summary
    exit "$status"
  fi
  echo "----------------------------------------"
  echo "    OK ${name} — $(fmt_dur "$elapsed")"
}

print_summary() {
  local total=$(($(date +%s) - SCRIPT_START))
  echo
  echo "════════════════════════════════════════════════════════"
  echo "  Build & Push Summary"
  echo "════════════════════════════════════════════════════════"
  local i
  for ((i = 0; i < ${#STEP_NAMES[@]}; i++)); do
    printf "  %-42s %s\n" "${STEP_NAMES[$i]}" "$(fmt_dur "${STEP_TIMES[$i]}")"
  done
  echo "  --------------------------------------------------"
  printf "  %-42s %s\n" "TOTAL" "$(fmt_dur "$total")"
  echo "════════════════════════════════════════════════════════"
  echo "  Image: ${FULL_TAG}"
  echo "  Pull:  docker pull ${FULL_TAG}"
  echo "════════════════════════════════════════════════════════"
}

# ---------- Step impls ----------
do_git_push() {
  if [ "$SKIP_GIT_PUSH" = "1" ]; then
    echo "(SKIP_GIT_PUSH=1, skipping)"
    return 0
  fi
  git push "$GIT_REMOTE" "HEAD:$GIT_BRANCH"
}

do_docker_login() {
  printf '%s' "$REGISTRY_PASS" | docker login "$REGISTRY" \
    --username "$REGISTRY_USER" --password-stdin
}

do_docker_build() {
  docker build \
    --build-arg "NPM_REGISTRY=${NPM_REGISTRY}" \
    --build-arg "CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION}" \
    -t "${FULL_TAG}" \
    "${GIT_CONTEXT_URL}"
}

do_docker_push() {
  docker push "${FULL_TAG}"
}

# ---------- Run ----------
echo "Target image : ${FULL_TAG}"
echo "Source       : ${GIT_CONTEXT_URL}"
echo "npm registry : ${NPM_REGISTRY}"
echo "claude code  : ${CLAUDE_CODE_VERSION}"

run_step "git push ${GIT_REMOTE}/${GIT_BRANCH}" do_git_push
run_step "docker login ${REGISTRY}"             do_docker_login
run_step "docker build ${IMAGE_TAG}"             do_docker_build
run_step "docker push ${IMAGE_TAG}"              do_docker_push

print_summary
