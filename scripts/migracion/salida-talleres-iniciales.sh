#!/bin/bash
# Salida (Fase 9), parte 2: con el sitio definitivo ya desplegado (scripts/desplegar-produccion.sh), crea el super administrador de la plataforma,
# el taller de cortesía de `enova` (y le traslada sus datos) y el taller de demostración (con datos de ejemplo).
# Las contraseñas temporales NUNCA se muestran en pantalla: se guardan en una carpeta local FUERA del repositorio (ACCESOS) y se pasan directo a los programas.
# Uso (desde backend/, con el sitio ya desplegado):  bash ../scripts/migracion/salida-talleres-iniciales.sh <correo del super administrador> <correo del administrador de enova> <correo del administrador de la demo> [carpeta de datos de enova]
set -euo pipefail
cd "$(dirname "$0")/../../backend"

SA_CORREO="${1:?Falta el correo del super administrador}"
ENOVA_CORREO="${2:?Falta el correo del administrador de enova}"
DEMO_CORREO="${3:?Falta el correo del administrador de la demostración}"
DATOS="${4:-/c/GUATECH/MIGRACION_ENOVA/datos}"
SERVIDOR=guatech-vps
APP=/home/veritech/app/backend
API=https://app.veritech.lat/api/taller
ACCESOS=/c/GUATECH/ACCESOS_VERITECH_4
mkdir -p "$ACCESOS"; chmod 700 "$ACCESOS"
NODO="sudo -u veritech node"

clave_de() { sed -n 's/^Contraseña temporal[^:]*: //p' | head -1; }
guardar() { printf '%s\n' "$2" > "$ACCESOS/$1.txt"; chmod 600 "$ACCESOS/$1.txt"; }
entrar() { # slug correo clave -> token (no se muestra)
  curl -s -m 30 -X POST "$API/auth/ingresar" -H "X-Taller: $1" -H 'Content-Type: application/json' -d "{\"correo\":\"$2\",\"contrasena\":\"$3\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(!j.data||!j.data.token){console.error("No se pudo entrar:",j.error||j.codigo);process.exit(1)}process.stdout.write(j.data.token)})'
}

echo "== 1. Super administrador de la plataforma"
if [ ! -f "$ACCESOS/superadmin.txt" ]; then
  SALIDA=$(ssh $SERVIDOR "cd $APP && $NODO dist/cli/crear-superadmin.js '$SA_CORREO' 'SUPER ADMINISTRADOR'" 2>/dev/null) || { echo "$SALIDA" | grep -v 'Contraseña' ; echo "No se pudo crear (¿ya existe?)."; exit 1; }
  guardar superadmin "$(echo "$SALIDA" | clave_de)"
  echo "   creado: $SA_CORREO (contraseña guardada en $ACCESOS/superadmin.txt)"
else
  echo "   ya estaba creado (se usa lo guardado)"
fi

echo "== 2. Taller de cortesía de enova"
if [ ! -f "$ACCESOS/enova.txt" ]; then
  SALIDA=$(ssh $SERVIDOR "cd $APP && $NODO dist/cli/crear-taller-especial.js --tipo cortesia --slug enova --nombre 'ENOVA' --admin 'ADMINISTRADOR ENOVA' --correo '$ENOVA_CORREO' --plan PROFESIONAL" 2>/dev/null)
  echo "$SALIDA" | grep -v 'Contraseña'
  guardar enova "$(echo "$SALIDA" | clave_de)"
else
  echo "   ya estaba creado"
fi
TOKEN=$(entrar enova "$ENOVA_CORREO" "$(cat "$ACCESOS/enova.txt")")
echo "== 3. Ensayo del traslado de enova (no escribe nada)"
MIGRACION_TOKEN="$TOKEN" node dist/cli/migrar-enova.js --datos "$DATOS" --url "$API" --taller enova --simular | tail -40
echo "== 4. Traslado real de enova"
MIGRACION_TOKEN="$TOKEN" node dist/cli/migrar-enova.js --datos "$DATOS" --url "$API" --taller enova | tail -60

echo "== 5. Taller de demostración"
if [ ! -f "$ACCESOS/demo.txt" ]; then
  SALIDA=$(ssh $SERVIDOR "cd $APP && $NODO dist/cli/crear-taller-especial.js --tipo demo --slug demo --nombre 'TALLER DE DEMOSTRACION' --admin 'ADMINISTRADOR DEMO' --correo '$DEMO_CORREO' --plan PROFESIONAL" 2>/dev/null)
  echo "$SALIDA" | grep -v 'Contraseña'
  guardar demo "$(echo "$SALIDA" | clave_de)"
  TOKEN_DEMO=$(entrar demo "$DEMO_CORREO" "$(cat "$ACCESOS/demo.txt")")
  MIGRACION_TOKEN="$TOKEN_DEMO" node dist/cli/sembrar-demo.js --url "$API" --taller demo
else
  echo "   ya estaba creado"
fi
echo "Listo. Contraseñas temporales en $ACCESOS (cámbielas al ingresar)."
