#!/usr/bin/env bash
# ============================================================
# Generate a random SAFECLAW_ACCESS_TOKEN and write it into
# .env.ucloud so deploy-ucloud.sh picks it up on the next run.
#
# Usage:
#   ./scripts/gen-access-token.sh                  # 32-byte token, default .env.ucloud
#   LENGTH=48 ./scripts/gen-access-token.sh        # custom byte length
#   ENV_UCLOUD=./prod.env ./scripts/gen-access-token.sh
#   FORCE=1 ./scripts/gen-access-token.sh          # overwrite existing token
#   PRINT_ONLY=1 ./scripts/gen-access-token.sh     # print to stdout, don't write
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_UCLOUD="${ENV_UCLOUD:-${REPO_ROOT}/.env.ucloud}"
LENGTH="${LENGTH:-32}"
FORCE="${FORCE:-0}"
PRINT_ONLY="${PRINT_ONLY:-0}"

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "${LENGTH}" | tr -d '\n=+/' | cut -c1-"${LENGTH}"
  elif [ -r /dev/urandom ]; then
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${LENGTH}"
  else
    echo "neither openssl nor /dev/urandom available" >&2
    exit 1
  fi
}

TOKEN="$(gen_token)"

if [ "${PRINT_ONLY}" = "1" ]; then
  echo "${TOKEN}"
  exit 0
fi

if [ ! -f "${ENV_UCLOUD}" ]; then
  touch "${ENV_UCLOUD}"
  chmod 600 "${ENV_UCLOUD}"
fi

if grep -qE '^SAFECLAW_ACCESS_TOKEN=' "${ENV_UCLOUD}"; then
  if [ "${FORCE}" != "1" ]; then
    existing=$(grep -E '^SAFECLAW_ACCESS_TOKEN=' "${ENV_UCLOUD}" | head -n1 | cut -d= -f2-)
    echo "SAFECLAW_ACCESS_TOKEN already set in ${ENV_UCLOUD}"
    echo "  current: ${existing}"
    echo "  rerun with FORCE=1 to overwrite, or PRINT_ONLY=1 to just print a candidate"
    exit 0
  fi
  # Replace existing line in place (portable sed)
  tmp="$(mktemp)"
  awk -v tok="${TOKEN}" '
    /^SAFECLAW_ACCESS_TOKEN=/ { print "SAFECLAW_ACCESS_TOKEN=" tok; replaced=1; next }
    { print }
    END { if (!replaced) print "SAFECLAW_ACCESS_TOKEN=" tok }
  ' "${ENV_UCLOUD}" > "${tmp}"
  mv "${tmp}" "${ENV_UCLOUD}"
else
  # Append, ensuring trailing newline first
  [ -s "${ENV_UCLOUD}" ] && [ "$(tail -c1 "${ENV_UCLOUD}")" != "" ] && printf '\n' >> "${ENV_UCLOUD}"
  printf 'SAFECLAW_ACCESS_TOKEN=%s\n' "${TOKEN}" >> "${ENV_UCLOUD}"
fi

chmod 600 "${ENV_UCLOUD}"

echo "Generated SAFECLAW_ACCESS_TOKEN (${LENGTH} chars) → ${ENV_UCLOUD}"
echo "  ${TOKEN}"
echo
echo "Next: ./scripts/deploy-ucloud.sh"
