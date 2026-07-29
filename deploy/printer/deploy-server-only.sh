#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

APP_ROOT=/opt/mini-has
CURRENT_LINK="${APP_ROOT}/current"
RELEASES_ROOT="${APP_ROOT}/releases"
RUNTIME_DIR="${APP_ROOT}/runtime"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-server-$$"
RELEASE_DIR="${RELEASES_ROOT}/${RELEASE_ID}"
TEMP_DIR="$(mktemp -d /tmp/mini-has-server-deploy.XXXXXX)"
previous_release=
swapped=false
healthy=false

cleanup() {
  find "${TEMP_DIR}" -depth -delete 2>/dev/null || true
  if [[ "${swapped}" != "true" && -d "${RELEASE_DIR}" ]]; then
    find "${RELEASE_DIR}" -depth -delete 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  echo "ERRO: $*" >&2
  return 1
}

rollback() {
  local status=$?
  trap - ERR HUP INT TERM
  if [[ "${swapped}" == "true" && "${healthy}" != "true" ]]; then
    ln -sfn "${previous_release}" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "${CURRENT_LINK}"
    systemctl restart mini-has-server.service || true
    swapped=false
  fi
  exit "${status}"
}
trap rollback ERR HUP INT TERM

print_state() {
  curl -fsS --max-time 5 \
    'http://127.0.0.1:7125/printer/objects/query?print_stats' |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["status"]["print_stats"]["state"])'
}

ensure_printer_idle() {
  local state
  state="$(print_state 2>/dev/null || true)"
  case "${state}" in
    standby|complete|error|cancelled) ;;
    printing|paused) fail "a impressora esta ${state}; deploy cancelado" ;;
    *) fail "nao foi possivel confirmar que a impressora esta parada" ;;
  esac
}

[[ "${EUID}" -eq 0 ]] || fail "execute com sudo"
[[ "$(uname -m)" == "aarch64" ]] || fail "este deploy exige Raspberry Pi ARM64"
[[ -d "${REPO_ROOT}/server/src" ]] || fail "fonte do backend ausente"

exec 9>/run/lock/mini-has-install.lock
flock -n 9 || fail "outro deploy Mini-HAS esta em execucao"

previous_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
[[ -n "${previous_release}" && -d "${previous_release}/server" ]] ||
  fail "release atual invalida"
ensure_printer_idle
systemctl is-active --quiet moonraker nginx mini-has-server mini-has-client ||
  fail "servicos obrigatorios nao estao ativos"

install -d -m 0755 "${RELEASE_DIR}"
cp -al "${previous_release}/." "${RELEASE_DIR}/"
find "${RELEASE_DIR}/server" -depth -delete
cp -a "${previous_release}/server" "${RELEASE_DIR}/server"
find "${RELEASE_DIR}/client/.next/cache" -depth -delete 2>/dev/null || true
install -d -m 0750 -o mini-has-client -g mini-has-client \
  "${RELEASE_DIR}/client/.next/cache"

rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='dist/' \
  --exclude='node_modules/' \
  "${REPO_ROOT}/server/" "${RELEASE_DIR}/server/"

chown -R mini-has-server:mini-has-server "${RELEASE_DIR}/server"
chmod 0711 "${TEMP_DIR}"
install -d -m 0750 -o mini-has-server -g mini-has-server "${TEMP_DIR}/npm-cache"

for command_name in ci build prune; do
  case "${command_name}" in
    ci)
      npm_args=(ci)
      ;;
    build)
      npm_args=(run build)
      ;;
    prune)
      npm_args=(prune --omit=dev)
      ;;
  esac
  systemd-run \
    --quiet \
    --wait \
    --collect \
    --pipe \
    --unit="mini-has-server-build-${RELEASE_ID}-${command_name}" \
    --property=CPUQuota=100% \
    --property=MemoryMax=1536M \
    --property=IOWeight=10 \
    --property=Nice=15 \
    --property=IOSchedulingClass=idle \
    /usr/sbin/runuser -u mini-has-server -- \
    env \
    PATH="${RUNTIME_DIR}/node/bin:/usr/bin:/bin" \
    npm_config_cache="${TEMP_DIR}/npm-cache" \
    "${RUNTIME_DIR}/node/bin/npm" \
    --prefix "${RELEASE_DIR}/server" \
    "${npm_args[@]}"
done

[[ -f "${RELEASE_DIR}/server/dist/main.js" ]] ||
  fail "build do backend incompleto"
chown -R root:root "${RELEASE_DIR}"
chown -R mini-has-client:mini-has-client "${RELEASE_DIR}/client/.next/cache"

ensure_printer_idle
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.new"
mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"
swapped=true
systemctl restart mini-has-server.service

for _ in {1..30}; do
  curl -fsS --max-time 2 http://127.0.0.1:8000/health >/dev/null && break
  sleep 1
done
curl -fsS --max-time 2 http://127.0.0.1:8000/health >/dev/null ||
  fail "backend nao ficou saudavel"
systemctl is-active --quiet moonraker nginx mini-has-client ||
  fail "servico protegido deixou de responder"

healthy=true

mapfile -t releases < <(
  find "${RELEASES_ROOT}" -mindepth 1 -maxdepth 1 -type d \
    -printf '%T@ %p\n' |
    sort -nr |
    cut -d' ' -f2-
)
for ((index = 2; index < ${#releases[@]}; index++)); do
  [[ "${releases[index]}" == "${RELEASES_ROOT}/"* ]] ||
    fail "caminho de release inesperado"
  find "${releases[index]}" -depth -delete
done

echo "Backend Mini-HAS atualizado."
