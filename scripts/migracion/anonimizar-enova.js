// Convierte las tablas bajadas de `enova` (datos reales, fuera del repositorio) en una copia SIN datos personales para las pruebas.
// Uso: node scripts/migracion/anonimizar-enova.js <carpeta con los .tsv reales> <carpeta de salida>
const fs = require('fs');
const path = require('path');

const [, , origen, destino] = process.argv;
if (!origen || !destino) {
  console.error('Uso: node anonimizar-enova.js <origen> <destino>');
  process.exit(1);
}
fs.mkdirSync(destino, { recursive: true });

function leer(nombre) {
  const f = path.join(origen, `${nombre}.tsv`);
  if (!fs.existsSync(f)) return null;
  const lineas = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0);
  return { cabecera: lineas[0].split('\t'), filas: lineas.slice(1).map((l) => l.split('\t')) };
}
function escribir(nombre, t) {
  fs.writeFileSync(path.join(destino, `${nombre}.tsv`), [t.cabecera.join('\t'), ...t.filas.map((f) => f.join('\t'))].join('\n') + '\n');
}
const poner = (t, columna, f) => {
  const i = t.cabecera.indexOf(columna);
  if (i >= 0) t.filas.forEach((fila, n) => (fila[i] = f(fila[i], n)));
};

// Las que no llevan datos personales se copian tal cual.
const SIN_CAMBIOS = ['catalog_sistemas', 'catalog_subsistemas', 'catalog_partes', 'catalog_acciones', 'catalog_trabajos', 'cat_trabajos_tiempos', 'catalog_tipos_equipo', 'catalog_marcas_equipo', 'catalog_tipo_contador', 'catalog_puestos', 'catalog_nivel_tecnico', 'catalog_unidades', 'order_items', 'ot_contadores_lecturas', 'equipo_contadores', 'colaborador_puesto', 'operador_equipo_asignaciones', 'checklist_types', 'checklist_templates', 'checklist_type_tipos_equipo', 'inventory_movements'];
for (const n of SIN_CAMBIOS) {
  const t = leer(n);
  if (t) escribir(n, t);
}

let t = leer('clients');
poner(t, 'name', () => 'CLIENTE DE PRUEBA S.A.');
poner(t, 'email', () => 'cliente@ejemplo.test');
poner(t, 'phone', () => '5555 0001');
poner(t, 'phone2', () => '5555 0002');
poner(t, 'contact', () => 'CONTACTO DE PRUEBA');
poner(t, 'notes', () => 'NULL');
escribir('clients', t);

t = leer('departamentos');
poner(t, 'nombre', (v, n) => 'SEDE ' + (n + 1));
escribir('departamentos', t);

t = leer('proveedores');
poner(t, 'nombre', () => 'PROVEEDOR DE PRUEBA');
poner(t, 'contacto_nombre', () => 'NULL');
escribir('proveedores', t);

t = leer('equipos');
poner(t, 'plate', (v, n) => (v === 'NULL' ? v : `PL-${n}`));
poner(t, 'vin', (v, n) => `SERIE-PRUEBA-${n}`);
poner(t, 'internal_code', (v, n) => `EQ-${n + 1}`);
poner(t, 'notes', () => 'NULL');
escribir('equipos', t);

t = leer('colaboradores');
poner(t, 'nombre_completo', (v, n) => `COLABORADOR DE PRUEBA ${n + 1}`);
poner(t, 'dpi', () => 'NULL');
poner(t, 'celular', () => 'NULL');
poner(t, 'correo', () => 'NULL');
poner(t, 'licencia_numero', () => 'NULL');
poner(t, 'direccion', () => 'NULL');
poner(t, 'cliente_texto', () => 'NULL');
escribir('colaboradores', t);

t = leer('operadores_deprecated_20260825');
poner(t, 'nombre_completo', () => 'COLABORADOR DE PRUEBA 1');
for (const c of ['dpi', 'celular', 'correo', 'licencia_numero', 'direccion', 'cliente_texto']) poner(t, c, () => 'NULL');
escribir('operadores_deprecated_20260825', t);

t = leer('users');
poner(t, 'name', () => 'ADMIN DE PRUEBA');
poner(t, 'email', () => 'admin@ejemplo.test');
poner(t, 'password', () => 'NULL');
poner(t, 'phone', () => 'NULL');
escribir('users', t);

t = leer('orders');
poner(t, 'notify_contact_name', () => 'CONTACTO DE PRUEBA');
poner(t, 'notify_email', () => 'cliente@ejemplo.test');
poner(t, 'notify_phone', () => '5555 0001');
poner(t, 'descripcion', () => 'MONTAR 100 PIEZAS');
escribir('orders', t);

t = leer('inventory');
poner(t, 'supplier', () => 'PROVEEDOR DE PRUEBA');
poner(t, 'description', (v, n) => 'DESCRIPCION ' + (n + 1));
poner(t, 'location', () => 'BODEGA');
escribir('inventory', t);
console.log('Listo: copia anónima en', destino);
