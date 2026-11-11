#!/bin/bash
# Despliega el VERI-TECH 4.000 al sitio de pruebas https://pruebas.veritech.lat (servidor guatech-vps).
# Corre antes todas las pruebas y la compilación: si algo falla, NO se sube nada.
# No toca el sistema actual (pm2 "veritech", puerto 4000) ni ningún taller.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVIDOR=guatech-vps
CUENTA=veritech
APP=/home/$CUENTA/pruebas
DOCROOT=/home/$CUENTA/pruebas.veritech.lat
PM2=/usr/local/bin/pm2
SSH="ssh -o ConnectTimeout=20 -o BatchMode=yes $SERVIDOR"

echo "== Pruebas y compilación (backend)"
(cd backend && npm run typecheck && npm test && npm run build)
echo "== Pruebas y compilación (frontend)"
(cd frontend && npm run typecheck && npm test && npm run build)

echo "== Subiendo backend y migraciones"
tar czf - backend/dist backend/package.json backend/package-lock.json database \
  | $SSH "tar xzf - --no-same-owner -C $APP && chown -R $CUENTA:$CUENTA $APP"

echo "== Subiendo frontend"
tar czf - -C frontend/dist . \
  | $SSH "tar xzf - --no-same-owner -C $DOCROOT && chown -R $CUENTA:$CUENTA $DOCROOT"

echo "== Retirando archivos viejos de assets (los que ya no están en esta compilación)"
(cd frontend/dist/assets && ls) | $SSH "cd $DOCROOT/assets && cat > /tmp/assets_vigentes.txt && for f in *; do grep -qxF \"\$f\" /tmp/assets_vigentes.txt || { echo \"  - \$f\"; rm -f \"\$f\"; }; done; rm -f /tmp/assets_vigentes.txt"

echo "== Dependencias, migraciones y reinicio"
$SSH "set -e; cd $APP/backend; sudo -u $CUENTA npm ci --omit=dev --silent; sudo -u $CUENTA node dist/cli/migrar.js plataforma; \
  if sudo -u $CUENTA $PM2 describe veritech-pruebas >/dev/null 2>&1; then sudo -u $CUENTA $PM2 restart veritech-pruebas --update-env >/dev/null; \
  else sudo -u $CUENTA $PM2 start dist/index.js --name veritech-pruebas --cwd $APP/backend >/dev/null; fi; sudo -u $CUENTA $PM2 save >/dev/null"

echo "== Verificando en vivo"
VERSION_LOCAL=$(grep -o "'[0-9]*\.[0-9]*'" backend/src/version.ts | tr -d "'")
for i in 1 2 3 4 5; do
  RESPUESTA=$(curl -s -m 10 https://pruebas.veritech.lat/health || true)
  if echo "$RESPUESTA" | grep -q "\"version\":\"$VERSION_LOCAL\"" && echo "$RESPUESTA" | grep -q '"base":"ok"'; then
    echo "OK: $RESPUESTA"; exit 0
  fi
  sleep 3
done
echo "FALLO: el sitio de pruebas no respondió con la versión $VERSION_LOCAL. Última respuesta: $RESPUESTA"
exit 1
