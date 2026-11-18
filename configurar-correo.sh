#!/usr/bin/env bash
# Configura el correo de salida de s360 (pedidos a proveedores, enlaces de alta…) con la cuenta
# compras@hamenorca.com de IONOS. La contraseña se escribe aquí, en el servidor: no pasa por ningún otro sitio.
#   cd /opt/s360 && bash configurar-correo.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "No encuentro .env en $(pwd)"; exit 1; }

read -r -p "Cuenta de correo [compras@hamenorca.com]: " CUENTA
CUENTA=${CUENTA:-compras@hamenorca.com}
read -r -s -p "Contraseña de ${CUENTA}: " CLAVE; echo
[ -n "$CLAVE" ] || { echo "Sin contraseña no se configura nada."; exit 1; }
case "$CLAVE" in *"'"*) echo "La contraseña no puede llevar comilla simple ('). Cámbiala en IONOS y vuelve a intentarlo."; exit 1;; esac
read -r -p "Nombre del remitente [HAM Menorca]: " NOMBRE
NOMBRE=${NOMBRE:-HAM Menorca}

poner() {  # poner CLAVE VALOR  (reemplaza o añade la línea en .env)
  local k="$1" v="$2"
  grep -v "^${k}=" .env > .env.tmp || true
  printf "%s='%s'\n" "$k" "$v" >> .env.tmp
  mv .env.tmp .env
}
poner SMTP_HOST smtp.ionos.es
poner SMTP_PORT 587
poner SMTP_SECURE false
poner SMTP_USER "$CUENTA"
poner SMTP_PASS "$CLAVE"
poner SMTP_FROM "${NOMBRE} <${CUENTA}>"
chmod 600 .env

echo "Reiniciando la aplicación…"
docker compose up -d web >/dev/null
sleep 8
echo "Probando la conexión con IONOS…"
if docker compose exec -T web node -e "
  const t = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT, secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  t.verify().then(() => { console.log('✔ Correo configurado: s360 ya puede enviar desde', process.env.SMTP_USER); }, (e) => { console.error('✗ No conecta:', e.message); process.exit(1); });
"; then exit 0; else echo "Revisa la cuenta y la contraseña y vuelve a ejecutar este script."; exit 1; fi
