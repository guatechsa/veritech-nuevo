#!/bin/bash
# SOLO LECTURA: baja a JSON las tablas con datos de veritech_enova (sin tokens ni claves).
ssh guatech-vps 'mysql -N veritech_enova -e "SELECT table_name FROM information_schema.tables WHERE table_schema=\"veritech_enova\" AND table_rows>0 AND table_name NOT IN (\"refresh_tokens\",\"role_action_permissions\",\"role_module_permissions\")"' 2>/dev/null > tablas.txt
mkdir -p datos
while read t; do
  ssh -n guatech-vps "mysql veritech_enova --batch -e 'SELECT * FROM \`$t\`'" 2>/dev/null > "datos/$t.tsv"
done < tablas.txt
wc -l datos/*.tsv | tail -50
