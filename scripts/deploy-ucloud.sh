#!/usr/bin/env bash
# ============================================================
# Deploy claw-office from UCloud uhub registry to a local Docker
# container. Idempotent — re-running redeploys (pull + recreate).
#
# Steps (timed individually):
#   1. docker login (skipped if already authenticated for this host)
#   2. docker pull <tag>
#   3. docker rm -f <existing container>
#   4. docker run -d ...
#   5. wait for /api/health to return 200
#
# Credentials are loaded from .env.ucloud (gitignored). See .env.ucloud.example
# for the template. Override anything via env vars, e.g.:
#   IMAGE_TAG=v0.0.2 ./scripts/deploy-ucloud.sh
#   PORT=8080 ./scripts/deploy-ucloud.sh
#   WORKSPACE_PATH=$HOME/projects ./scripts/deploy-ucloud.sh
#   ENV_FILE=./prod.env ./scripts/deploy-ucloud.sh    # auto-load API keys etc.
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
REGISTRY="${REGISTRY:-uhub.service.ucloud.cn}"
REGISTRY_USER="${REGISTRY_USER:?REGISTRY_USER not set (define it in ${ENV_UCLOUD} or export it)}"
REGISTRY_PASS="${REGISTRY_PASS:?REGISTRY_PASS not set (define it in ${ENV_UCLOUD} or export it)}"
IMAGE_NAME="${IMAGE_NAME:-zrt-application/claw-office-o}"
IMAGE_TAG="${IMAGE_TAG:-v0.0.1}"
FULL_TAG="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

CONTAINER_NAME="${CONTAINER_NAME:-claw-office}"
PORT="${PORT:-3811}"
DATA_VOLUME="${DATA_VOLUME:-claw-office-data}"
WORKSPACE_PATH="${WORKSPACE_PATH:-$HOME/claw-workspaces}"
RESTART_POLICY="${RESTART_POLICY:-unless-stopped}"

ENV_FILE="${ENV_FILE:-}"            # optional --env-file path (e.g. ./prod.env)
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-90}"
SKIP_LOGIN="${SKIP_LOGIN:-0}"        # 1 = trust existing docker auth

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
  echo "  Deploy Summary"
  echo "════════════════════════════════════════════════════════"
  local i
  for ((i = 0; i < ${#STEP_NAMES[@]}; i++)); do
    printf "  %-42s %s\n" "${STEP_NAMES[$i]}" "$(fmt_dur "${STEP_TIMES[$i]}")"
  done
  echo "  --------------------------------------------------"
  printf "  %-42s %s\n" "TOTAL" "$(fmt_dur "$total")"
  echo "════════════════════════════════════════════════════════"
  echo "  Container : ${CONTAINER_NAME}"
  echo "  Image     : ${FULL_TAG}"
  echo "  URL       : http://localhost:${PORT}"
  echo "  Logs      : docker logs -f ${CONTAINER_NAME}"
  echo "  Stop      : docker stop ${CONTAINER_NAME}"
  echo "════════════════════════════════════════════════════════"
}

# ---------- Step impls ----------
do_login() {
  if [ "$SKIP_LOGIN" = "1" ]; then
    echo "(SKIP_LOGIN=1, skipping)"
    return 0
  fi
  # Reuse existing auth if present for this registry
  if docker system info 2>/dev/null | grep -q "${REGISTRY}" || \
     grep -q "\"${REGISTRY}\"" "${HOME}/.docker/config.json" 2>/dev/null; then
    echo "(already authenticated to ${REGISTRY})"
    return 0
  fi
  printf '%s' "$REGISTRY_PASS" | docker login "$REGISTRY" \
    --username "$REGISTRY_USER" --password-stdin
}

do_pull() {
  docker pull "${FULL_TAG}"
}

do_remove_existing() {
  if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    echo "Removing existing container '${CONTAINER_NAME}'..."
    docker rm -f "${CONTAINER_NAME}" >/dev/null
  else
    echo "(no existing container)"
  fi
}

do_run() {
  mkdir -p "${WORKSPACE_PATH}"

  local args=(
    -d
    --name "${CONTAINER_NAME}"
    -p "${PORT}:${PORT}"
    -v "${DATA_VOLUME}:/data"
    -v "${WORKSPACE_PATH}:/workspaces"
    -e "NODE_ENV=production"
    -e "PORT=${PORT}"
    -e "CLAUDE_GUI_DATA_DIR=/data"
    -e "SAFECLAW_WORKSPACE=/workspaces"
    --restart "${RESTART_POLICY}"
  )

  if [ -n "${ENV_FILE}" ]; then
    if [ ! -f "${ENV_FILE}" ]; then
      echo "ENV_FILE='${ENV_FILE}' not found"
      return 1
    fi
    args+=(--env-file "${ENV_FILE}")
    echo "Using env-file: ${ENV_FILE}"
  fi

  docker run "${args[@]}" "${FULL_TAG}"
}

do_health_wait() {
  local deadline=$(($(date +%s) + HEALTH_TIMEOUT_SEC))
  local url="http://localhost:${PORT}${HEALTH_PATH}"
  echo "Polling ${url} (timeout ${HEALTH_TIMEOUT_SEC}s)..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "${url}" || echo "000")
    if [ "$code" = "200" ]; then
      echo "    /api/health → 200 OK"
      return 0
    fi
    # Bail out early if the container died
    local state
    state=$(docker inspect -f '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "missing")
    if [ "$state" != "running" ]; then
      echo "    container state=${state}, last logs:"
      docker logs --tail 30 "${CONTAINER_NAME}" 2>&1 || true
      return 1
    fi
    sleep 2
  done
  echo "    timed out waiting for health endpoint"
  docker logs --tail 50 "${CONTAINER_NAME}" 2>&1 || true
  return 1
}

# ---------- Run ----------
echo "Image      : ${FULL_TAG}"
echo "Container  : ${CONTAINER_NAME}"
echo "Port       : ${PORT}"
echo "Data vol   : ${DATA_VOLUME}"
echo "Workspaces : ${WORKSPACE_PATH}"
[ -n "${ENV_FILE}" ] && echo "Env file   : ${ENV_FILE}"

run_step "docker login ${REGISTRY}"      do_login
run_step "docker pull ${IMAGE_TAG}"      do_pull
run_step "remove existing container"     do_remove_existing
run_step "docker run ${CONTAINER_NAME}"  do_run
run_step "wait for /api/health"          do_health_wait

print_summary
