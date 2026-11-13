#!/bin/bash
# Despliega VERI-TECH 4.000 al sitio DEFINITIVO https://app.veritech.lat (servidor guatech-vps). Se corre a mano, desde la computadora de Luis o de Claude.
# Seguridad: solo despliega el commit actual si la integración continua de GitHub lo dio por bueno (pruebas + app móvil + compilación) y si está subido.
# No toca el sistema anterior (pm2 "veritech", puerto 4000) ni el sitio de pruebas (pm2 "veritech-pruebas", puerto 4300).
# Uso: bash scripts/desplegar-produccion.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SERVIDOR=guatech-vps
CUENTA=veritech
APP=/home/$CUENTA/app
DOCROOT=/home/$CUENTA/app.veritech.lat
PM2=/usr/local/bin/pm2
NOMBRE=veritech-app
PUERTO=4310
SSH="ssh -o ConnectTimeout=20 -o BatchMode=yes $SERVIDOR"

echo "== Revisando que este commit esté subido y aprobado por la integración continua"
git fetch -q origin master
HEAD_SHA=$(git rev-parse HEAD)
[ "$(git rev-parse origin/master)" = "$HEAD_SHA" ] || { echo "ABORTA: el commit actual no es el último de master en GitHub (suba o actualice primero)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "ABORTA: hay cambios sin guardar en el repositorio."; exit 1; }
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
ESTADO=$(curl -s -m 30 -H "Authorization: Bearer $TOKEN" "https://api.github.com/repos/guatechsa/veritech-nuevo/actions/runs?head_sha=$HEAD_SHA&per_page=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=(JSON.parse(d).workflow_runs||[])[0];console.log(r?r.status+"|"+r.conclusion:"sin_corrida")})')
[ "$ESTADO" = "completed|success" ] || { echo "ABORTA: la integración continua de este commit no está en verde (estado: $ESTADO)."; exit 1; }

echo "== Compilación (backend y frontend)"
(cd backend && npm run typecheck && npm run build)
(cd frontend && npm run typecheck && MSYS_NO_PATHCONV=1 npm run build)
grep -q "Files/Git" frontend/dist/assets/*.js && { echo "ABORTA: el frontend quedó con una ruta de Git Bash pegada (ver MSYS_NO_PATHCONV)."; exit 1; } || true

echo "== Subiendo backend y migraciones"
tar czf - backend/dist backend/package.json backend/package-lock.json database \
  | $SSH "tar xzf - --no-same-owner -C $APP && chown -R $CUENTA:$CUENTA $APP"

echo "== Subiendo frontend (conserva el .htaccess del sitio)"
tar czf - -C frontend/dist . \
  | $SSH "tar xzf - --no-same-owner -C $DOCROOT && chown -R $CUENTA:$CUENTA $DOCROOT"
$SSH "cd $DOCROOT/assets && cat > /tmp/assets_vigentes_app.txt" < <(cd frontend/dist/assets && ls)
$SSH "cd $DOCROOT/assets && for f in *; do grep -qxF \"\$f\" /tmp/assets_vigentes_app.txt || { echo \"  - retirado \$f\"; rm -f \"\$f\"; }; done; rm -f /tmp/assets_vigentes_app.txt"

echo "== Dependencias, migraciones y reinicio"
$SSH "set -e; cd $APP/backend; sudo -u $CUENTA npm ci --omit=dev --silent; sudo -u $CUENTA node dist/cli/migrar.js plataforma; sudo -u $CUENTA node dist/cli/migrar.js talleres; \
  if sudo -u $CUENTA $PM2 describe $NOMBRE >/dev/null 2>&1; then sudo -u $CUENTA $PM2 restart $NOMBRE --update-env >/dev/null; \
  else sudo -u $CUENTA $PM2 start dist/index.js --name $NOMBRE --cwd $APP/backend >/dev/null; fi; sudo -u $CUENTA $PM2 save >/dev/null"

echo "== Verificando en vivo"
VERSION_LOCAL=$(grep -o "'[0-9]*\.[0-9]*'" backend/src/version.ts | tr -d "'")
for i in 1 2 3 4 5 6; do
  RESPUESTA=$(curl -s -m 10 https://app.veritech.lat/health || true)
  if echo "$RESPUESTA" | grep -q "\"version\":\"$VERSION_LOCAL\"" && echo "$RESPUESTA" | grep -q '"base":"ok"'; then
    echo "OK: $RESPUESTA"; exit 0
  fi
  sleep 4
done
echo "FALLO: app.veritech.lat no respondió con la versión $VERSION_LOCAL. Última respuesta: $RESPUESTA"
exit 1
