#!/usr/bin/env bash
# Instala o actualiza el planificador s360 en un servidor Linux (VPS con Plesk o sin él).
#
# Primera vez (como root), todo en uno:
#   curl -fsSL https://raw.githubusercontent.com/grupodixis/planner/main/desplegar-vps.sh \
#     | bash -s -- --dominio administrador.hamenorca.com --auto
#
# Opciones:
#   --dominio sub.dominio.com  publícalo en Plesk: crea el subdominio, certificado Let's Encrypt,
#                              redirección a HTTPS y proxy nginx → la aplicación
#   --email correo             correo para Let's Encrypt (si no, el de Plesk)
#   --auto                     actualización automática: cada 5 min mira GitHub y, si hay
#                              cambios, actualiza (con copia de la base de datos y vuelta atrás
#                              si la nueva versión no arranca)
#   --puerto 8380              puerto local (solo 127.0.0.1)
#   --dir /opt/s360            carpeta de instalación
#   --restaurar copia.sql      carga una copia de la base de datos (pg_dump en texto)
#   --si-hay-cambios           (lo usa el temporizador) solo actúa si GitHub tiene algo nuevo
#
# Se puede ejecutar las veces que haga falta.
set -euo pipefail

REPO="https://github.com/grupodixis/planner.git"
DIR="/opt/s360"
PUERTO="8380"
RESTAURAR=""
DOMINIO=""
EMAIL=""
AUTO=0
SOLO_CAMBIOS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --puerto) PUERTO="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --restaurar) RESTAURAR="$(readlink -f "$2")"; shift 2 ;;
    --dominio) DOMINIO="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --auto) AUTO=1; shift ;;
    --si-hay-cambios) SOLO_CAMBIOS=1; shift ;;
    *) echo "Opción desconocida: $1"; exit 1 ;;
  esac
done

DOMINIO_ARG="$DOMINIO"   # si se pasó --dominio, manda sobre servidor.conf
# Configuración del servidor guardada en el repositorio (dominio, correo de Let's Encrypt)
if [ -f "$DIR/servidor.conf" ]; then
  # shellcheck disable=SC1091
  . "$DIR/servidor.conf"
  DOMINIO="${DOMINIO:-${S360_DOMINIO:-}}"
  EMAIL="${EMAIL:-${S360_EMAIL:-}}"
fi

# Semillero (áreas, máquinas, herramientas…): se carga si servidor.conf lo pide (S360_SEMILLERO=si o
# sin-personas) y semillero/semillero.json cambió desde la última carga (huella en .semillero-aplicado)
semillero_pendiente() {
  case "${S360_SEMILLERO:-no}" in si|sin-personas) ;; *) return 1 ;; esac
  [ -f "$DIR/semillero/semillero.json" ] || return 1
  local huella; huella="$(cat "$DIR/semillero/semillero.json" "$DIR/servidor.conf" | sha256sum | cut -c1-64)"
  [ "$huella" != "$(cat "$DIR/.semillero-aplicado" 2>/dev/null)" ]
}

paso() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Ejecútalo como root"; exit 1; }

# Una sola ejecución a la vez (el temporizador y una manual no se pisan)
exec 9>/var/lock/s360-desplegar.lock
flock -n 9 || { echo "Ya hay una actualización en marcha"; exit 0; }

# Modo temporizador: si GitHub no tiene nada nuevo, no hace nada
if [ "$SOLO_CAMBIOS" = 1 ]; then
  [ -d "$DIR/.git" ] || exit 0
  git -C "$DIR" fetch -q origin main
  if [ "$(git -C "$DIR" rev-parse HEAD)" = "$(git -C "$DIR" rev-parse origin/main)" ]; then
    # sin cambios: solo se comprueba que la publicación en Plesk está hecha y el semillero cargado
    if [ -n "$DOMINIO" ] && command -v plesk >/dev/null 2>&1 \
       && ! grep -qs "s360 planificador" "/var/www/vhosts/system/${DOMINIO}/conf/vhost_nginx.conf"; then
      SOLO_PLESK=1
      echo "$(date '+%F %T') Sin cambios de código; falta publicar en Plesk"
    elif semillero_pendiente; then
      SOLO_PLESK=1
      echo "$(date '+%F %T') Sin cambios de código; falta cargar el semillero"
    else
      exit 0
    fi
  else
    echo "$(date '+%F %T') Hay cambios en GitHub: actualizando"
  fi
fi
SOLO_PLESK="${SOLO_PLESK:-0}"

# Dirección pública en .env (enlaces de activación y de recuperar contraseña). Devuelve 0 si cambió.
poner_app_url() {
  [ -n "$DOMINIO" ] && [ -f .env ] || return 1
  if grep -q '^APP_URL=' .env; then
    grep -qx "APP_URL=https://${DOMINIO}" .env && return 1
    sed -i "s|^APP_URL=.*|APP_URL=https://${DOMINIO}|" .env
  else
    printf '\n# Dirección pública de la web (enlaces de los correos)\nAPP_URL=https://%s\n' "$DOMINIO" >> .env
  fi
  return 0
}

if [ "$SOLO_PLESK" = 1 ]; then
  cd "$DIR"; PUERTO="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"
  # cambió el dominio: la web se reinicia con la dirección nueva
  if poner_app_url; then docker compose up -d web >/dev/null 2>&1 && echo "Dirección pública: https://${DOMINIO}"; fi
fi

if [ "$SOLO_PLESK" = 0 ] && [ "$SOLO_CAMBIOS" = 0 ]; then
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
fi

if [ "$SOLO_PLESK" = 0 ]; then
paso "Código en $DIR"
ANTERIOR=""
if [ -d "$DIR/.git" ]; then
  ANTERIOR="$(git -C "$DIR" rev-parse HEAD)"
  git -C "$DIR" fetch -q origin main && git -C "$DIR" reset -q --hard origin/main
else
  git clone -q "$REPO" "$DIR"
fi
cd "$DIR"
git log --oneline -1
git rev-parse --short HEAD > app/public/version.txt
# el servidor.conf recién descargado manda (p. ej. si cambió el dominio)
if [ -z "$DOMINIO_ARG" ] && [ -f servidor.conf ]; then
  # shellcheck disable=SC1091
  . ./servidor.conf
  DOMINIO="${S360_DOMINIO:-$DOMINIO}"
  EMAIL="${S360_EMAIL:-$EMAIL}"
fi

NUEVO=0
ADMIN_PASS=""
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
PUERTO="$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"
poner_app_url || true

if [ "$NUEVO" = 0 ] && docker compose ps --status running db 2>/dev/null | grep -q db; then
  paso "Copia de seguridad de la base de datos"
  mkdir -p backups
  docker compose exec -T db pg_dump -U s360 s360 > "backups/s360-$(date +%Y%m%d-%H%M).sql"
  ls -1t backups/*.sql | tail -n +21 | xargs -r rm --   # se guardan las 20 últimas
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

responde() {
  for _ in $(seq 1 45); do
    curl -fsS "http://127.0.0.1:${PUERTO}/health" 2>/dev/null | grep -q "\"$(cat app/public/version.txt)\"" && return 0
    sleep 2
  done
  return 1
}

paso "Construyendo y arrancando"
if docker compose up -d --build && responde; then
  echo "El planificador responde en http://127.0.0.1:${PUERTO} (versión $(cat app/public/version.txt))"
else
  aviso "La nueva versión no arranca."
  docker compose logs --tail 40 web || true
  if [ -n "$ANTERIOR" ]; then
    aviso "Volviendo a la versión anterior ${ANTERIOR:0:7}"
    git reset -q --hard "$ANTERIOR"
    git rev-parse --short HEAD > app/public/version.txt
    docker compose up -d --build && responde && echo "Versión anterior en marcha."
  fi
  exit 1
fi
fi  # fin de instalación / actualización

# Publicar en Plesk: subdominio, proxy nginx y certificado
if [ -n "$DOMINIO" ]; then
  paso "Publicando en Plesk: https://${DOMINIO}"
  if ! command -v plesk >/dev/null 2>&1; then
    aviso "No encuentro Plesk en este servidor: configura el proxy a http://127.0.0.1:${PUERTO} a mano."
  else
    if ! plesk bin site --info "$DOMINIO" >/dev/null 2>&1; then
      PADRE="${DOMINIO#*.}"; SUB="${DOMINIO%%.*}"
      if plesk bin domain --info "$PADRE" >/dev/null 2>&1; then
        plesk bin subdomain --create "$SUB" -domain "$PADRE" && echo "Subdominio creado." \
          || aviso "No pude crear el subdominio: créalo en Plesk y vuelve a ejecutar."
      else
        aviso "El dominio ${PADRE} no está en este Plesk: crea ${DOMINIO} en Plesk y vuelve a ejecutar."
      fi
    else
      echo "El subdominio ya existe."
    fi
    CONF="/var/www/vhosts/system/${DOMINIO}/conf"
    if [ -d "$CONF" ]; then
      NUEVA="$(mktemp)"
      cat > "$NUEVA" <<NGINX
# s360 planificador → contenedor Docker (lo escribe desplegar-vps.sh; no editar a mano)
location ~ ^/ {
    proxy_pass http://127.0.0.1:${PUERTO};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
    client_max_body_size 5m;
}
NGINX
      if ! cmp -s "$NUEVA" "$CONF/vhost_nginx.conf"; then
        [ -f "$CONF/vhost_nginx.conf" ] && cp "$CONF/vhost_nginx.conf" "$CONF/vhost_nginx.conf.antes-s360"
        cp "$NUEVA" "$CONF/vhost_nginx.conf"
        chmod 644 "$CONF/vhost_nginx.conf"
        if plesk sbin httpdmng --reconfigure-domain "$DOMINIO" >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
          systemctl reload nginx 2>/dev/null || true
          echo "Proxy nginx configurado."
        else
          aviso "nginx no acepta la configuración: la quito."
          if [ -f "$CONF/vhost_nginx.conf.antes-s360" ]; then
            mv "$CONF/vhost_nginx.conf.antes-s360" "$CONF/vhost_nginx.conf"
          else
            rm -f "$CONF/vhost_nginx.conf"
          fi
          plesk sbin httpdmng --reconfigure-domain "$DOMINIO" >/dev/null 2>&1 || true
        fi
      else
        echo "Proxy nginx ya configurado."
      fi
      rm -f "$NUEVA"
      # Certificado: si HTTPS falla por el certificado, se pide a Let's Encrypt
      set +e
      curl -sS -o /dev/null --max-time 15 "https://${DOMINIO}/health" 2>/dev/null
      CODIGO=$?
      set -e
      if [ "$CODIGO" = 60 ] || [ "$CODIGO" = 35 ] || [ "$CODIGO" = 51 ] || [ "$CODIGO" = 7 ]; then
        echo "Pidiendo certificado Let's Encrypt…"
        if plesk bin extension --exec letsencrypt cli.php -d "$DOMINIO" ${EMAIL:+-m "$EMAIL"}; then
          echo "Certificado emitido."
        else
          aviso "No pude emitir el certificado: emítelo en Plesk → SSL/TLS."
        fi
      fi
      plesk bin site --update "$DOMINIO" -ssl-redirect true >/dev/null 2>&1 \
        || plesk bin subscription --update "$DOMINIO" -ssl-redirect true >/dev/null 2>&1 || true
      if curl -fsS --max-time 15 "https://${DOMINIO}/health" 2>/dev/null; then
        echo " ← responde por HTTPS"
      else
        aviso "Aún no responde por https://${DOMINIO}."
      fi
    else
      aviso "No encuentro la configuración de ${DOMINIO} en Plesk (${CONF})."
    fi
  fi
fi

# Cargar el semillero si toca (copia de seguridad antes)
if semillero_pendiente && docker compose ps --status running web 2>/dev/null | grep -q web; then
  paso "Cargando el semillero (${S360_SEMILLERO})"
  mkdir -p backups
  docker compose exec -T db pg_dump -U s360 s360 > "backups/s360-antes-semillero-$(date +%Y%m%d-%H%M).sql"
  OPC=""; [ "$S360_SEMILLERO" = sin-personas ] && OPC="--sin-personas"
  if docker compose exec -T web node src/cargar-semillero.js $OPC < semillero/semillero.json; then
    cat semillero/semillero.json servidor.conf | sha256sum | cut -c1-64 > .semillero-aplicado
  else
    aviso "No se pudo cargar el semillero (la base de datos no ha cambiado)."
  fi
fi

# Actualización automática desde GitHub
if [ "$AUTO" = 1 ]; then
  paso "Activando la actualización automática (cada 5 minutos)"
  cat > /etc/systemd/system/s360-actualizar.service <<EOF
[Unit]
Description=s360 planificador: actualizar desde GitHub si hay cambios
After=docker.service network-online.target

[Service]
Type=oneshot
# Se ejecuta una copia: git puede cambiar el script mientras se actualiza
ExecStart=/bin/bash -c 'cp ${DIR}/desplegar-vps.sh /tmp/s360-desplegar.sh && exec /bin/bash /tmp/s360-desplegar.sh --dir ${DIR} --si-hay-cambios'
EOF
  cat > /etc/systemd/system/s360-actualizar.timer <<EOF
[Unit]
Description=s360 planificador: mirar GitHub cada 5 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now s360-actualizar.timer
  echo "Listo. Registro: journalctl -u s360-actualizar --since today"
fi

if [ "$NUEVO" = 1 ]; then
  cat <<EOF

────────────────────────────────────────────────────────────
 Instalado. Acceso inicial (guárdalo; está en $DIR/.env):
   Usuario:    admin@s360.local
   Contraseña: ${ADMIN_PASS}
$( [ -n "$RESTAURAR" ] && echo "   (Con la copia restaurada valen los usuarios y contraseñas de esa copia)" )
────────────────────────────────────────────────────────────
EOF
fi
