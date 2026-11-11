#!/bin/bash
# Despliegue automático del sitio de pruebas de VERI-TECH 4.000 (https://pruebas.veritech.lat).
# Es el COMANDO FORZADO de la llave de GitHub Actions (authorized_keys de root): esa llave no puede ejecutar nada más.
# Recibe por la entrada estándar un paquete .tgz con: backend/dist, backend/package.json, backend/package-lock.json,
# database/ y frontend-dist/. Solo toca /home/veritech/pruebas y /home/veritech/pruebas.veritech.lat.
# No toca el sistema actual (pm2 "veritech", puerto 4000) ni ningún taller.
set -euo pipefail

CUENTA=veritech
APP=/home/$CUENTA/pruebas
DOCROOT=/home/$CUENTA/pruebas.veritech.lat
PM2=/usr/local/bin/pm2
PUERTO=4300

TMP=$(mktemp -d /tmp/vtn-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

tar xzf - -C "$TMP" --no-same-owner --no-same-permissions
for ruta in backend/dist backend/package.json backend/package-lock.json database frontend-dist frontend-dist/index.html; do
  [ -e "$TMP/$ruta" ] || { echo "ERROR: falta $ruta en el paquete"; exit 1; }
done

echo "== backend y migraciones"
rm -rf "$APP/backend/dist" "$APP/database"
cp -r "$TMP/backend/dist" "$APP/backend/dist"
cp "$TMP/backend/package.json" "$TMP/backend/package-lock.json" "$APP/backend/"
cp -r "$TMP/database" "$APP/database"

echo "== frontend"
cp -r "$TMP/frontend-dist/." "$DOCROOT/"
if [ -d "$TMP/frontend-dist/assets" ]; then
  ( cd "$TMP/frontend-dist/assets" && ls ) > "$TMP/vigentes.txt"
  ( cd "$DOCROOT/assets" && for f in *; do grep -qxF "$f" "$TMP/vigentes.txt" || { echo "  - $f"; rm -f "$f"; }; done )
fi
chown -R $CUENTA:$CUENTA "$APP" "$DOCROOT"

echo "== dependencias, migraciones y reinicio"
cd "$APP/backend"
sudo -u $CUENTA npm ci --omit=dev --silent
sudo -u $CUENTA node dist/cli/migrar.js plataforma
if sudo -u $CUENTA $PM2 describe veritech-pruebas >/dev/null 2>&1; then
  sudo -u $CUENTA $PM2 restart veritech-pruebas --update-env >/dev/null
else
  sudo -u $CUENTA $PM2 start dist/index.js --name veritech-pruebas --cwd "$APP/backend" >/dev/null
fi
sudo -u $CUENTA $PM2 save >/dev/null

echo "== verificación"
for i in 1 2 3 4 5 6; do
  R=$(curl -s -m 5 "http://127.0.0.1:$PUERTO/health" || true)
  if echo "$R" | grep -q '"success":true'; then echo "OK $R"; exit 0; fi
  sleep 2
done
echo "FALLO: el backend no respondió sano. Últimas líneas del registro:"
sudo -u $CUENTA $PM2 logs veritech-pruebas --lines 20 --nostream || true
exit 1
