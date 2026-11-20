#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

APP_ROOT=/opt/mini-has
RELEASES_ROOT="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
RUNTIME_DIR="${APP_ROOT}/runtime"
STATE_ROOT=/var/lib/mini-has
CONFIG_ROOT=/etc/mini-has
NODE_VERSION=22.23.1
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-arm64.tar.xz"
NODE_SHA256=0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1
CLOUDFLARED_VERSION=2026.7.3
CLOUDFLARED_DEB=cloudflared-linux-arm64.deb
CLOUDFLARED_SHA256=d3ea7d22dd337b465da33d6bc1c4b3cfd381407447a2a7d29542c19783430db3
CAMERA_AI_VERSION=2.1.6
CAMERA_AI_WHEEL=ai_edge_litert-2.1.6-cp311-cp311-manylinux_2_27_aarch64.whl
CAMERA_AI_WHEEL_URL=https://files.pythonhosted.org/packages/53/b5/da7057bfd08f270b5d924c4daba62a583df6dc25d916955fc7543d1c8847/ai_edge_litert-2.1.6-cp311-cp311-manylinux_2_27_aarch64.whl
CAMERA_AI_WHEEL_SHA256=8475d18c73698d9244380ad72f67caf540e5c72d9a80c66d17c4b81ca81a21c8
CAMERA_AI_MODEL_URL='https://tfhub.dev/tensorflow/lite-model/efficientdet/lite0/detection/default/1?lite-format=tflite'
CAMERA_AI_MODEL_SHA256=33a3b622c7cac0762f96089353cd61495f3e993968d133af7871bfc2d5396704
CAMERA_AI_LABELS_URL=https://storage.googleapis.com/mediapipe-tasks/object_detector/labelmap.txt
CAMERA_AI_LABELS_SHA256=f8803ef7900160c629d570848dfda4175e21667bf7b71f73f8ece4938c9f2bf2
CAMERA_AI_VENV="${RUNTIME_DIR}/camera-ai"
CAMERA_AI_MODELS="${RUNTIME_DIR}/models"
LAN_IP=192.168.1.57

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
TEMP_DIR="$(mktemp -d /tmp/mini-has-install.XXXXXX)"
chmod 0711 "${TEMP_DIR}"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE_DIR="${RELEASES_ROOT}/${RELEASE_ID}"
previous_release=
swapped=false
deploy_healthy=false
build_counter=0
server_was_active=false
client_was_active=false
tunnel_was_active=false
camera_ai_was_active=false
matterbridge_ready=false

cleanup() {
  local active_release
  find "${TEMP_DIR}" -depth -delete 2>/dev/null || true
  active_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
  if [[ "${swapped}" != "true" && -d "${RELEASE_DIR}" &&
    "${active_release}" != "${RELEASE_DIR}" ]]; then
    find "${RELEASE_DIR}" -depth -delete 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  echo "ERRO: $*" >&2
  return 1
}

get_print_state() {
  curl -fsS --max-time 5 \
    'http://127.0.0.1:7125/printer/objects/query?print_stats' |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["status"]["print_stats"]["state"])' \
    2>/dev/null || true
}

ensure_printer_idle() {
  local print_state
  print_state="$(get_print_state)"
  case "${print_state}" in
    printing|paused)
      fail "a impressora esta ${print_state}; deploy cancelado"
      ;;
    standby|complete|error|cancelled)
      ;;
    *)
      fail "nao foi possivel confirmar que a impressora esta parada"
      ;;
  esac
}

rollback_current() {
  if [[ "${swapped}" == "true" && "${deploy_healthy}" != "true" ]]; then
    echo "Falha apos a troca; restaurando a versao anterior." >&2
    systemctl stop mini-has-camera-ai.service 2>/dev/null || true
    if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
      ln -sfn "${previous_release}" "${CURRENT_LINK}.rollback"
      mv -Tf "${CURRENT_LINK}.rollback" "${CURRENT_LINK}"
      systemctl daemon-reload || true
      [[ "${server_was_active}" == "true" ]] &&
        systemctl restart mini-has-server.service || true
      [[ "${client_was_active}" == "true" ]] &&
        systemctl restart mini-has-client.service || true
      [[ "${tunnel_was_active}" == "true" ]] &&
        systemctl restart mini-has-cloudflared.service || true
      [[ "${camera_ai_was_active}" == "true" ]] &&
        systemctl restart mini-has-camera-ai.service || true
    else
      systemctl stop mini-has-client.service mini-has-server.service 2>/dev/null || true
      unlink "${CURRENT_LINK}" 2>/dev/null || true
    fi
    swapped=false
  fi
}

rollback_on_error() {
  local status=$?
  trap - ERR
  rollback_current
  exit "${status}"
}
trap rollback_on_error ERR

handle_signal() {
  trap - ERR HUP INT TERM
  rollback_current
  exit 130
}
trap handle_signal HUP INT TERM

run_limited() {
  local account=$1
  local cache_dir=$2
  shift 2
  build_counter=$((build_counter + 1))
  systemd-run \
    --quiet \
    --wait \
    --collect \
    --pipe \
    --unit="mini-has-build-${RELEASE_ID}-${build_counter}" \
    --property=CPUQuota=100% \
    --property=MemoryMax=1536M \
    --property=IOWeight=10 \
    --property=Nice=15 \
    --property=IOSchedulingClass=idle \
    /usr/sbin/runuser -u "${account}" -- \
    env \
    PATH="${RUNTIME_DIR}/node/bin:/usr/bin:/bin" \
    npm_config_cache="${cache_dir}" \
    NEXT_TELEMETRY_DISABLED=1 \
    "$@"
}

[[ "${EUID}" -eq 0 ]] || fail "execute com sudo"
[[ "$(uname -m)" == "aarch64" ]] || fail "este instalador exige Raspberry Pi ARM64"
[[ -f "${REPO_ROOT}/config/printer.env" ]] || fail "config/printer.env ausente"
[[ -f "${REPO_ROOT}/server/data/mini-has.db" ]] || fail "banco Mini-HAS ausente"

exec 9>/run/lock/mini-has-install.lock
flock -n 9 || fail "outro instalador Mini-HAS esta em execucao"

ensure_printer_idle

for service in moonraker nginx; do
  systemctl is-active --quiet "${service}" || fail "${service} nao esta ativo"
done

tunnel_ready=false
tunnel_credentials=
if [[ -f "${REPO_ROOT}/config/cloudflared/config.native.yml" ]]; then
  shopt -s nullglob
  credentials=("${REPO_ROOT}"/config/cloudflared/*.json)
  shopt -u nullglob
  ((${#credentials[@]} == 1)) ||
    fail "esperado exatamente um JSON de credencial do tunnel"
  tunnel_credentials="${credentials[0]}"
  tunnel_ready=true
fi

if ss -ltnH | awk -v lan="${LAN_IP}:1883" \
  '$4 == lan || $4 == "0.0.0.0:1883" || $4 == "*:1883" || $4 == "[::]:1883" {
    found=1
  }
  END { exit !found }'; then
  [[ -f /etc/mosquitto/conf.d/mini-has.conf ]] &&
    grep -q '^# Managed by Mini-HAS' /etc/mosquitto/conf.d/mini-has.conf ||
    fail "porta 1883 ja esta em uso por outro broker"
fi

for account in server client tunnel; do
  user="mini-has-${account}"
  getent group "${user}" >/dev/null || groupadd --system "${user}"
  id -u "${user}" >/dev/null 2>&1 || useradd \
    --system \
    --gid "${user}" \
    --home-dir "${STATE_ROOT}/${account}" \
    --shell /usr/sbin/nologin \
    "${user}"
done

install -d -m 0755 "${APP_ROOT}" "${RELEASES_ROOT}" "${RUNTIME_DIR}"
install -d -m 0751 -o root -g root "${CONFIG_ROOT}"
install -d -m 0750 -o mini-has-server -g mini-has-server \
  "${STATE_ROOT}/server" \
  "${STATE_ROOT}/server/camera-recordings" \
  "${STATE_ROOT}/server/camera-spool"
install -d -m 0750 -o mini-has-client -g mini-has-client \
  "${STATE_ROOT}/client" \
  "${STATE_ROOT}/client/uploads" \
  "${STATE_ROOT}/client/uploads/floors"
install -d -m 0750 -o mini-has-tunnel -g mini-has-tunnel "${STATE_ROOT}/tunnel"
install -d -m 0750 -o root -g mini-has-tunnel "${CONFIG_ROOT}/cloudflared"

available_kb="$(df --output=avail -k "${APP_ROOT}" | tail -n 1 | tr -d ' ')"
((available_kb >= 4194304)) || fail "menos de 4 GB livres; deploy cancelado"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  avahi-daemon \
  build-essential \
  ca-certificates \
  curl \
  ffmpeg \
  mosquitto \
  mosquitto-clients \
  python3 \
  python3-dbus \
  python3-venv \
  rsync \
  sqlite3 \
  xz-utils

[[ -x /usr/bin/ffmpeg ]] || fail "ffmpeg nao foi instalado corretamente"

if [[ ! -x "${RUNTIME_DIR}/node/bin/node" ]] ||
  [[ "$("${RUNTIME_DIR}/node/bin/node" --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
  curl -fsSL \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    -o "${TEMP_DIR}/${NODE_ARCHIVE}"
  (
    cd "${TEMP_DIR}"
    echo "${NODE_SHA256}  ${NODE_ARCHIVE}" | sha256sum -c -
  )
  tar -xJf "${TEMP_DIR}/${NODE_ARCHIVE}" -C "${RUNTIME_DIR}"
  ln -sfn "${RUNTIME_DIR}/node-v${NODE_VERSION}-linux-arm64" "${RUNTIME_DIR}/node"
fi

[[ "$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" == "3.11" ]] ||
  fail "o detector exige Python 3.11 neste Raspberry"
camera_ai_installed_version="$(
  "${CAMERA_AI_VENV}/bin/python" -c \
    'import importlib.metadata; print(importlib.metadata.version("ai-edge-litert"))' \
    2>/dev/null || true
)"
if [[ "${camera_ai_installed_version}" != "${CAMERA_AI_VERSION}" ]]; then
  curl -fsSL "${CAMERA_AI_WHEEL_URL}" -o "${TEMP_DIR}/${CAMERA_AI_WHEEL}"
  (
    cd "${TEMP_DIR}"
    echo "${CAMERA_AI_WHEEL_SHA256}  ${CAMERA_AI_WHEEL}" | sha256sum -c -
  )
  if [[ -e "${CAMERA_AI_VENV}" ]]; then
    [[ "${CAMERA_AI_VENV}" == "${RUNTIME_DIR}/camera-ai" ]] ||
      fail "caminho inesperado do ambiente da IA"
    find "${CAMERA_AI_VENV}" -depth -delete
  fi
  python3 -m venv "${CAMERA_AI_VENV}"
  "${CAMERA_AI_VENV}/bin/pip" \
    --disable-pip-version-check \
    install \
    --no-cache-dir \
    --only-binary=:all: \
    "${TEMP_DIR}/${CAMERA_AI_WHEEL}"
fi

install -d -m 0750 -o root -g mini-has-server "${CAMERA_AI_MODELS}"
camera_ai_model="${CAMERA_AI_MODELS}/efficientdet_lite0_int8.tflite"
if [[ ! -f "${camera_ai_model}" ]] ||
  [[ "$(sha256sum "${camera_ai_model}" | cut -d' ' -f1)" != "${CAMERA_AI_MODEL_SHA256}" ]]; then
  curl -fsSL "${CAMERA_AI_MODEL_URL}" -o "${TEMP_DIR}/efficientdet_lite0_int8.tflite"
  (
    cd "${TEMP_DIR}"
    echo "${CAMERA_AI_MODEL_SHA256}  efficientdet_lite0_int8.tflite" | sha256sum -c -
  )
  install -m 0640 -o root -g mini-has-server \
    "${TEMP_DIR}/efficientdet_lite0_int8.tflite" \
    "${camera_ai_model}"
fi

camera_ai_labels="${CAMERA_AI_MODELS}/coco_labelmap.txt"
if [[ ! -f "${camera_ai_labels}" ]] ||
  [[ "$(sha256sum "${camera_ai_labels}" | cut -d' ' -f1)" != "${CAMERA_AI_LABELS_SHA256}" ]]; then
  curl -fsSL "${CAMERA_AI_LABELS_URL}" -o "${TEMP_DIR}/coco_labelmap.txt"
  (
    cd "${TEMP_DIR}"
    echo "${CAMERA_AI_LABELS_SHA256}  coco_labelmap.txt" | sha256sum -c -
  )
  install -m 0640 -o root -g mini-has-server \
    "${TEMP_DIR}/coco_labelmap.txt" \
    "${camera_ai_labels}"
fi

chown -R root:mini-has-server "${CAMERA_AI_VENV}"
chmod -R g+rX,o-rwx "${CAMERA_AI_VENV}"
runuser -u mini-has-server -- "${CAMERA_AI_VENV}/bin/python" -c \
  'from ai_edge_litert.interpreter import Interpreter; import sys; detector=Interpreter(model_path=sys.argv[1], num_threads=1); detector.allocate_tensors(); assert detector.get_input_details()[0]["shape"].tolist() == [1, 320, 320, 3]; shapes=sorted(tuple(int(value) for value in item["shape"]) for item in detector.get_output_details()); assert shapes == [(1,), (1, 25), (1, 25), (1, 25, 4)]' \
  "${camera_ai_model}"

if ! command -v cloudflared >/dev/null 2>&1 ||
  [[ "$(cloudflared --version 2>/dev/null || true)" != *"${CLOUDFLARED_VERSION}"* ]]; then
  curl -fsSL \
    "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${CLOUDFLARED_DEB}" \
    -o "${TEMP_DIR}/${CLOUDFLARED_DEB}"
  (
    cd "${TEMP_DIR}"
    echo "${CLOUDFLARED_SHA256}  ${CLOUDFLARED_DEB}" | sha256sum -c -
  )
  dpkg -i "${TEMP_DIR}/${CLOUDFLARED_DEB}"
fi

install -m 0640 -o root -g mini-has-server \
  "${REPO_ROOT}/config/printer.env" \
  "${CONFIG_ROOT}/server.env"
integration_env_backup="${TEMP_DIR}/server-integrations.env"
install -m 0600 /dev/null "${integration_env_backup}"
if [[ -f "${CONFIG_ROOT}/server-integrations.env" ]]; then
  grep -E '^(GEMINI_API_KEY|CAMERA_SEMANTIC_[A-Z0-9_]+|GOOGLE_DRIVE_[A-Z0-9_]+|CAMERA_CLOUD_[A-Z0-9_]+)=' \
    "${CONFIG_ROOT}/server-integrations.env" >"${integration_env_backup}" || true
fi
if [[ -f "${REPO_ROOT}/server/.env" ]]; then
  install -m 0640 -o root -g mini-has-server \
    "${REPO_ROOT}/server/.env" \
    "${CONFIG_ROOT}/server-integrations.env"
else
  find "${CONFIG_ROOT}/server-integrations.env" -maxdepth 0 -type f -delete 2>/dev/null || true
fi
if [[ -s "${integration_env_backup}" ]]; then
  touch "${CONFIG_ROOT}/server-integrations.env"
  while IFS= read -r integration_line; do
    integration_key="${integration_line%%=*}"
    [[ "${integration_key}" =~ ^(GEMINI_API_KEY|CAMERA_SEMANTIC_[A-Z0-9_]+|GOOGLE_DRIVE_[A-Z0-9_]+|CAMERA_CLOUD_[A-Z0-9_]+)$ ]] ||
      fail "chave de integracao inesperada"
    if ! grep -q "^${integration_key}=" "${CONFIG_ROOT}/server-integrations.env"; then
      printf '%s\n' "${integration_line}" >>"${CONFIG_ROOT}/server-integrations.env"
    fi
  done <"${integration_env_backup}"
  chown root:mini-has-server "${CONFIG_ROOT}/server-integrations.env"
  chmod 0640 "${CONFIG_ROOT}/server-integrations.env"
fi
if [[ -f "${REPO_ROOT}/client/.env" ]]; then
  install -m 0640 -o root -g mini-has-client \
    "${REPO_ROOT}/client/.env" \
    "${CONFIG_ROOT}/client.env"
else
  find "${CONFIG_ROOT}/client.env" -maxdepth 0 -type f -delete 2>/dev/null || true
fi

if [[ -f "${STATE_ROOT}/server/mini-has.db" ]]; then
  backup_dir="${STATE_ROOT}/server/backups"
  install -d -m 0750 -o mini-has-server -g mini-has-server "${backup_dir}"
  backup_path="${backup_dir}/mini-has-$(date -u +%Y%m%dT%H%M%SZ).db"
  sqlite3 -cmd '.timeout 5000' \
    "${STATE_ROOT}/server/mini-has.db" ".backup '${backup_path}'"
  chown mini-has-server:mini-has-server "${backup_path}"
  chmod 0640 "${backup_path}"
  mapfile -t backups < <(
    find "${backup_dir}" -maxdepth 1 -type f -name 'mini-has-*.db' \
      -printf '%T@ %p\n' |
      sort -nr |
      cut -d' ' -f2-
  )
  for ((index = 5; index < ${#backups[@]}; index++)); do
    [[ "${backups[index]}" == "${backup_dir}/"* ]] ||
      fail "caminho de backup inesperado"
    find "${backups[index]}" -maxdepth 0 -type f -delete
  done
else
  sqlite3 -cmd '.timeout 5000' "${REPO_ROOT}/server/data/mini-has.db" \
    ".backup '${STATE_ROOT}/server/mini-has.db'"
  chown mini-has-server:mini-has-server "${STATE_ROOT}/server/mini-has.db"
  chmod 0640 "${STATE_ROOT}/server/mini-has.db"
fi
[[ "$(sqlite3 -cmd '.timeout 5000' \
  "${STATE_ROOT}/server/mini-has.db" 'PRAGMA quick_check;')" == "ok" ]] ||
  fail "integridade do banco invalida"

ensure_printer_idle
install -d -m 0755 "${RELEASE_DIR}"
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.next/' \
  --exclude='node_modules/' \
  --exclude='node_modules.*' \
  --exclude='*.nodevalt-backup-*' \
  --exclude='server/data/' \
  --exclude='server/.env' \
  --exclude='client/.env' \
  --exclude='config/printer.env' \
  --exclude='config/cloudflared/*.json' \
  --exclude='config/cloudflared/config*.yml' \
  "${REPO_ROOT}/" "${RELEASE_DIR}/"

chown -R root:root "${RELEASE_DIR}"
chown -R mini-has-server:mini-has-server "${RELEASE_DIR}/server"
chown -R mini-has-client:mini-has-client "${RELEASE_DIR}/client"

NODE_BIN="${RUNTIME_DIR}/node/bin"
NPM_CACHE="${TEMP_DIR}/npm-cache"
install -d -m 0750 -o mini-has-server -g mini-has-server "${NPM_CACHE}/server"
install -d -m 0750 -o mini-has-client -g mini-has-client "${NPM_CACHE}/client"

run_limited mini-has-server "${NPM_CACHE}/server" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/server" ci
run_limited mini-has-server "${NPM_CACHE}/server" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/server" run build
run_limited mini-has-server "${NPM_CACHE}/server" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/server" prune --omit=dev

run_limited mini-has-client "${NPM_CACHE}/client" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/client" ci
run_limited mini-has-client "${NPM_CACHE}/client" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/client" run build
run_limited mini-has-client "${NPM_CACHE}/client" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/client" prune --omit=dev
find "${RELEASE_DIR}/client/node_modules/sharp" -depth -delete 2>/dev/null || true
find "${RELEASE_DIR}/client/node_modules/@img" -depth -delete 2>/dev/null || true
run_limited mini-has-client "${NPM_CACHE}/client" \
  "${NODE_BIN}/npm" --prefix "${RELEASE_DIR}/client" \
  audit --omit=dev --omit=optional --audit-level=high

[[ -f "${RELEASE_DIR}/server/dist/main.js" ]] ||
  fail "build do backend incompleto"
[[ -f "${RELEASE_DIR}/client/.next/BUILD_ID" ]] ||
  fail "build do frontend incompleto"

chown -R root:root "${RELEASE_DIR}"
install -d -m 0750 "${RELEASE_DIR}/client/.next/cache"
chown -R mini-has-client:mini-has-client "${RELEASE_DIR}/client/.next/cache"

install -m 0644 \
  "${REPO_ROOT}/deploy/printer/mosquitto-mini-has.conf" \
  /etc/mosquitto/conf.d/mini-has.conf
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mini-has-server.service" \
  /etc/systemd/system/mini-has-server.service
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mini-has-camera-ai.service" \
  /etc/systemd/system/mini-has-camera-ai.service
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mini-has-client.service" \
  /etc/systemd/system/mini-has-client.service
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mini-has-cloudflared.service" \
  /etc/systemd/system/mini-has-cloudflared.service
install -m 0755 \
  "${REPO_ROOT}/deploy/printer/publish-mdns-alias.py" \
  "${RUNTIME_DIR}/publish-mdns-alias.py"
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mini-has-mdns-alias.service" \
  /etc/systemd/system/mini-has-mdns-alias.service
if [[ -f /opt/matterbridge/current/lib/node_modules/matterbridge/bin/matterbridge.js ]] &&
  getent passwd mini-has-matterbridge >/dev/null &&
  getent group mini-has-matterbridge >/dev/null; then
  install -m 0644 \
    "${REPO_ROOT}/deploy/printer/mini-has-matterbridge.service" \
    /etc/systemd/system/mini-has-matterbridge.service
  matterbridge_ready=true
fi
install -d -m 0755 /etc/systemd/system/mosquitto.service.d
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/systemd/mosquitto-mini-has-override.conf" \
  /etc/systemd/system/mosquitto.service.d/mini-has.conf
install -m 0644 \
  "${REPO_ROOT}/deploy/printer/nginx-mini-has.conf" \
  /etc/nginx/sites-available/mini-has
ln -sfn /etc/nginx/sites-available/mini-has /etc/nginx/sites-enabled/zz-mini-has
find /etc/nginx/conf.d/mini-has.conf -maxdepth 0 -type f -delete 2>/dev/null || true

nginx -t

if [[ "${tunnel_ready}" == "true" ]]; then
  find "${CONFIG_ROOT}/cloudflared" -maxdepth 1 -type f -name '*.json' -delete
  install -m 0640 -o root -g mini-has-tunnel \
    "${REPO_ROOT}/config/cloudflared/config.native.yml" \
    "${CONFIG_ROOT}/cloudflared/config.yml"
  install -m 0640 -o root -g mini-has-tunnel \
    "${tunnel_credentials}" \
    "${CONFIG_ROOT}/cloudflared/$(basename "${tunnel_credentials}")"
else
  find "${CONFIG_ROOT}/cloudflared" -maxdepth 1 -type f \
    \( -name 'config.yml' -o -name '*.json' \) -delete
fi

systemctl daemon-reload
systemctl enable \
  avahi-daemon.service \
  mini-has-mdns-alias.service \
  mini-has-camera-ai.service \
  mosquitto.service \
  mini-has-server.service \
  mini-has-client.service
for enabled_unit in \
  avahi-daemon.service \
  mini-has-mdns-alias.service \
  mini-has-camera-ai.service \
  mosquitto.service \
  mini-has-server.service \
  mini-has-client.service; do
  systemctl is-enabled --quiet "${enabled_unit}" ||
    fail "${enabled_unit} nao ficou habilitado para iniciar no boot"
done
if [[ "${matterbridge_ready}" == "true" ]]; then
  systemctl enable mini-has-matterbridge.service
  systemctl is-enabled --quiet mini-has-matterbridge.service ||
    fail "mini-has-matterbridge.service nao ficou habilitado para iniciar no boot"
fi
systemctl restart mini-has-mdns-alias.service
systemctl is-active --quiet mini-has-mdns-alias.service ||
  fail "alias mDNS casa.local nao iniciou"
systemctl restart mosquitto.service
systemctl is-active --quiet mosquitto.service || fail "broker MQTT nao iniciou"
mosquitto_pub \
  -h "${LAN_IP}" \
  -p 1883 \
  -t "mini-has/install-probe/${RELEASE_ID}" \
  -m "${RELEASE_ID}"

ensure_printer_idle
previous_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
systemctl is-active --quiet mini-has-server.service && server_was_active=true
systemctl is-active --quiet mini-has-client.service && client_was_active=true
systemctl is-active --quiet mini-has-cloudflared.service && tunnel_was_active=true
systemctl is-active --quiet mini-has-camera-ai.service && camera_ai_was_active=true
for unit in \
  mini-has-cloudflared.service \
  mini-has-client.service \
  mini-has-server.service \
  mini-has-camera-ai.service; do
  if systemctl is-active --quiet "${unit}"; then
    systemctl stop "${unit}"
  fi
  if systemctl is-active --quiet "${unit}"; then
    fail "${unit} nao parou"
  fi
done

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.new"
mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"
swapped=true

runuser -u mini-has-server -- \
  "${CAMERA_AI_VENV}/bin/python" \
  "${CURRENT_LINK}/server/scripts/camera-object-detector.py" \
  --self-test
runuser -u mini-has-server -- \
  "${CAMERA_AI_VENV}/bin/python" \
  "${CURRENT_LINK}/server/scripts/camera-object-detector.py" \
  --model "${camera_ai_model}" \
  --labels "${camera_ai_labels}" \
  --threads 1 \
  --smoke-test
systemctl restart mini-has-camera-ai.service
for _ in {1..30}; do
  [[ -S /run/mini-has-camera-ai/detector.sock ]] && break
  sleep 1
done
systemctl is-active --quiet mini-has-camera-ai.service ||
  fail "IA das cameras nao iniciou"
[[ -S /run/mini-has-camera-ai/detector.sock ]] ||
  fail "socket da IA das cameras nao ficou pronto"

systemctl restart mini-has-server.service

for _ in {1..60}; do
  curl -fsS --max-time 2 http://127.0.0.1:8000/health >/dev/null && break
  sleep 1
done
curl -fsS --max-time 2 http://127.0.0.1:8000/health >/dev/null ||
  fail "backend nao ficou saudavel"

systemctl restart mini-has-client.service
for _ in {1..30}; do
  curl -fsS --max-time 2 "http://${LAN_IP}:3000/login" >/dev/null && break
  sleep 1
done
curl -fsS --max-time 2 "http://${LAN_IP}:3000/login" >/dev/null ||
  fail "frontend nao ficou saudavel"

if [[ "${matterbridge_ready}" == "true" ]]; then
  systemctl restart mini-has-matterbridge.service
  systemctl is-active --quiet mini-has-matterbridge.service ||
    fail "Matterbridge nao iniciou"
fi

systemctl is-active --quiet moonraker.service || fail "Moonraker deixou de responder"
systemctl is-active --quiet nginx.service || fail "nginx deixou de responder"
systemctl is-active --quiet mini-has-camera-ai.service ||
  fail "IA das cameras deixou de responder"
curl -fsS --max-time 5 \
  'http://127.0.0.1:7125/printer/objects/query?print_stats' >/dev/null ||
  fail "Moonraker HTTP deixou de responder"
curl -fsS --max-time 5 http://127.0.0.1/ >/dev/null ||
  fail "Mainsail deixou de responder"
systemctl reload nginx.service
curl -fsS --max-time 5 -H 'Host: casa.local' http://127.0.0.1/login >/dev/null ||
  fail "rota casa.local nao ficou saudavel"
curl -fsS --max-time 5 -H 'Host: printer.local' http://127.0.0.1/ >/dev/null ||
  fail "Mainsail deixou de responder apos reload do nginx"

deploy_healthy=true

if [[ "${tunnel_ready}" == "true" ]]; then
  systemctl enable mini-has-cloudflared.service
  systemctl restart mini-has-cloudflared.service
  for _ in {1..30}; do
    curl -fsS --max-time 2 http://127.0.0.1:20241/ready >/dev/null && break
    sleep 1
  done
  curl -fsS --max-time 2 http://127.0.0.1:20241/ready >/dev/null ||
    fail "Cloudflare Tunnel nao ficou saudavel"
else
  systemctl disable mini-has-cloudflared.service 2>/dev/null || true
fi

active_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
[[ -n "${active_release}" && "${active_release}" == "${RELEASES_ROOT}/"* ]] ||
  fail "release atual inesperado"

mapfile -t releases < <(
  find "${RELEASES_ROOT}" -mindepth 1 -maxdepth 1 -type d \
    -print
)
for release in "${releases[@]}"; do
  [[ "${release}" == "${RELEASES_ROOT}/"* ]] ||
    fail "caminho de release inesperado"
  if [[ "${release}" == "${active_release}" ||
    "${release}" == "${previous_release}" ]]; then
    continue
  fi
  find "${release}" -depth -delete
done

echo "Mini-HAS instalado em http://${LAN_IP}:3000"
