#!/bin/bash
# Respaldo VERIFICADO de las bases del sistema anterior (3.xxx) antes de migrarlas o retirarlas (Fase 9).
# Qué hace (SOLO LECTURA sobre las bases; solo escribe archivos en una carpeta nueva del servidor):
#   1. Por cada base: mysqldump con un INSERT por fila (así se puede contar), comprimido con gzip.
#   2. Verifica: el archivo descomprime sin error; tiene un CREATE TABLE por cada tabla de la base; y por cada tabla,
#      la cantidad de filas del respaldo es IGUAL a la cantidad de filas de la base (se cuenta en ambos lados).
#   3. Escribe una suma de comprobación (sha256) de cada archivo.
# Uso:  bash respaldar-talleres-viejos.sh [carpeta_destino_en_el_servidor]
# Se corre desde esta computadora; ejecuta todo en el servidor por ssh (guatech-vps), con la cuenta `veritech`.
set -euo pipefail
DESTINO="${1:-/home/veritech/backups/fase9_$(date +%Y%m%d)}"
BASES="veritech_enova veritech_cafe veritech_waga veritech_platform"

ssh guatech-vps "bash -s" <<EOS
set -euo pipefail
mkdir -p "$DESTINO"
cd "$DESTINO"
ok=1
for b in $BASES; do
  mysqldump --single-transaction --routines --triggers --skip-extended-insert --skip-comments "\$b" 2>/dev/null | gzip -9 > "\$b.sql.gz"
  gzip -t "\$b.sql.gz" || { echo "MAL \$b: el archivo no descomprime"; ok=0; continue; }
  tablas=\$(mysql -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='\$b' AND table_type='BASE TABLE'" 2>/dev/null | sort)
  nt=\$(echo "\$tablas" | grep -c . || true)
  ct=\$(zcat "\$b.sql.gz" | grep -c '^CREATE TABLE ' || true)
  mal=0
  for t in \$tablas; do
    en_bd=\$(mysql -N -e "SELECT COUNT(*) FROM \\\`\$b\\\`.\\\`\$t\\\`" 2>/dev/null)
    en_resp=\$(zcat "\$b.sql.gz" | grep -c "^INSERT INTO \\\`\$t\\\` " || true)
    if [ "\$en_bd" != "\$en_resp" ]; then echo "MAL \$b.\$t: base=\$en_bd respaldo=\$en_resp"; mal=1; fi
  done
  if [ "\$nt" != "\$ct" ]; then echo "MAL \$b: tablas=\$nt create_table=\$ct"; mal=1; fi
  if [ "\$mal" = "0" ]; then echo "OK  \$b: \$nt tablas, todas las filas coinciden (\$(du -h "\$b.sql.gz" | cut -f1))"; else ok=0; fi
done
sha256sum *.sql.gz > SUMAS.sha256
chmod 600 *.sql.gz SUMAS.sha256
ls -l
[ "\$ok" = "1" ] && echo "RESPALDO VERIFICADO EN $DESTINO" || { echo "HAY PROBLEMAS: revise arriba"; exit 1; }
EOS
