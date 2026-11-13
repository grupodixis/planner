#!/usr/bin/env bash
# Instala o actualiza el planificador s360 en un servidor Linux (VPS con Plesk o sin él).
#
#   curl -fsSL https://raw.githubusercontent.com/grupodixis/planner/main/desplegar-vps.sh | bash
#
# Opciones (pasándolas tras «bash -s --»):
#   --puerto 8380          puerto local donde escucha (solo 127.0.0.1; lo publica nginx/Plesk)
#   --dir /opt/s360        carpeta de instalación
#   --restaurar copia.sql  carga una copia de la base de datos (pg_dump en texto) al instalar
#
# Es seguro ejecutarlo varias veces: la primera instala y crea contraseñas; las siguientes
# actualizan el código desde GitHub, hacen copia de la base de datos y reconstruyen.
set -euo pipefail

REPO="https://github.com/grupodixis/planner.git"
DIR="/opt/s360"
PUERTO="8380"
RESTAURAR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --puerto) PUERTO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --restaurar) RESTAURAR="$(readlink -f "$2")"; shift 2 ;;
    *) echo "Opción desconocida: $1"; exit 1 ;;
  esac
done

paso() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root"; exit 1; }

paso "Comprobando Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no está instalado: instalándolo…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Falta el plugin «docker compose»: instalándolo…"
  (apt-get update -qq && apt-get install -y -qq docker-compose-plugin) || (dnf install -y docker-compose-plugin) || true
fi
docker compose version
systemctl enable --now docker >/dev/null 2>&1 || true
command -v git >/dev/null 2>&1 || (apt-get install -y -qq git || dnf install -y git)

paso "Código en $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin && git -C "$DIR" reset -q --hard origin/main
else
  git clone -q "$REPO" "$DIR"
fi
cd "$DIR"
git log --oneline -1

NUEVO=0
if [ ! -f .env ]; then
  NUEVO=1
  paso "Creando .env con contraseñas nuevas"
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cat > .env <<EOF
POSTGRES_DB=s360
POSTGRES_USER=s360
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ADMIN_EMAIL=admin@s360.local
ADMIN_PASSWORD=${ADMIN_PASS}
# Solo escucha en el propio servidor; lo publica nginx (Plesk) con HTTPS
WEB_BIND=127.0.0.1
WEB_PORT=${PUERTO}
COOKIE_SECURE=true
JORNADA_INICIO=7
JORNADA_FIN=15
EOF
  chmod 600 .env
fi

if [ "$NUEVO" = 0 ] && docker compose ps --status running db 2>/dev/null | grep -q db; then
  paso "Copia de seguridad antes de actualizar"
  mkdir -p backups
  docker compose exec -T db pg_dump -U s360 s360 > "backups/antes-de-actualizar-$(date +%Y%m%d-%H%M).sql"
  ls -1t backups/*.sql | tail -n +11 | xargs -r rm --   # se guardan las 10 últimas
fi

if [ -n "$RESTAURAR" ]; then
  paso "Restaurando la copia $RESTAURAR"
  docker compose up -d db
  until docker compose exec -T db pg_isready -U s360 -d s360 >/dev/null 2>&1; do sleep 2; done
  docker compose stop web >/dev/null 2>&1 || true
  docker compose exec -T db psql -q -U s360 -d postgres -c "DROP DATABASE IF EXISTS s360 WITH (FORCE)" -c "CREATE DATABASE s360 OWNER s360"
  docker compose exec -T db psql -q -U s360 -d s360 < "$RESTAURAR" >/dev/null
  echo "Copia restaurada."
fi

paso "Construyendo y arrancando"
docker compose up -d --build
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${PUERTO}/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:${PUERTO}/health" >/dev/null && echo "El planificador responde en http://127.0.0.1:${PUERTO}" \
  || { echo "No responde todavía. Mira: docker compose -f $DIR/docker-compose.yml logs web"; exit 1; }

if [ "$NUEVO" = 1 ]; then
  cat <<EOF

────────────────────────────────────────────────────────────
 Instalado. Acceso inicial (guárdalo; está en $DIR/.env):
   Usuario:    admin@s360.local
   Contraseña: ${ADMIN_PASS}
$( [ -n "$RESTAURAR" ] && echo "   (Con la copia restaurada valen los usuarios y contraseñas de esa copia)" )
 Falta publicarlo en el subdominio desde Plesk (ver README → Publicar en un servidor):
   proxy de https://administrador.hamenorca.com → http://127.0.0.1:${PUERTO}
────────────────────────────────────────────────────────────
EOF
fi
