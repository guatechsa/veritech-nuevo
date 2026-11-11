-- Plataforma, migración 0002: módulos del producto y los tres niveles de plan (30 / 60 / 120 USD).
-- BORRADOR de límites (aprobado como punto de partida): las cantidades y los módulos de cada nivel se ajustan
-- desde el panel de planes o con una migración posterior.

INSERT INTO modulos (codigo, nombre, orden) VALUES
  ('ordenes',               'Órdenes de trabajo',         10),
  ('cotizaciones',          'Cotizaciones',               20),
  ('citas',                 'Citas',                      30),
  ('equipos',               'Equipos y contadores',       40),
  ('clientes',              'Clientes y proveedores',     50),
  ('checklists',            'Checklists',                 60),
  ('servicios_programados', 'Servicios programados',      70),
  ('inventario',            'Inventario y bodegas',       80),
  ('carga_taller',          'Carga de taller',            90),
  ('reportes',              'Reportes e indicadores',    100),
  ('contadores_condicion',  'Contadores por condición',  110),
  ('portal_cliente',        'Portal del cliente',        120),
  ('app_movil',             'App móvil',                 130);

INSERT INTO planes (codigo, nombre, precio_mensual, max_usuarios, max_sucursales) VALUES
  ('basico',       'BASICO',       30.00,  5,    1),
  ('profesional',  'PROFESIONAL',  60.00, 15,    3),
  ('empresarial',  'EMPRESARIAL', 120.00, NULL, NULL);

-- Básico: módulos base. Profesional: + portal del cliente y contadores por condición. Empresarial: todos.
INSERT INTO plan_modulos (plan_id, modulo_codigo)
SELECT p.id, m.codigo FROM planes p JOIN modulos m
 WHERE p.codigo = 'basico'
   AND m.codigo IN ('ordenes','cotizaciones','citas','equipos','clientes','checklists','servicios_programados','inventario','carga_taller','reportes','app_movil');

INSERT INTO plan_modulos (plan_id, modulo_codigo)
SELECT p.id, m.codigo FROM planes p JOIN modulos m
 WHERE p.codigo = 'profesional'
   AND m.codigo IN ('ordenes','cotizaciones','citas','equipos','clientes','checklists','servicios_programados','inventario','carga_taller','reportes','app_movil','portal_cliente','contadores_condicion');

INSERT INTO plan_modulos (plan_id, modulo_codigo)
SELECT p.id, m.codigo FROM planes p JOIN modulos m WHERE p.codigo = 'empresarial';
