-- Taller, migración 0002: acceso (sesiones, recuperación de contraseña) y permisos únicos `modulo.accion` (Fase 3a).
-- UN solo sistema de permisos (decisión del módulo 2): el menú sale de los permisos "ver" y todo lo que no está
-- concedido está prohibido. El rol administrador recibe TODOS los permisos como filas reales (no se reconoce "por nombre").
-- `modulo` es el código del módulo de la plataforma que debe estar habilitado para la empresa, o 'base' (siempre disponible).

CREATE TABLE permisos (
  codigo VARCHAR(60) NOT NULL,
  modulo VARCHAR(40) NOT NULL,
  descripcion VARCHAR(150) NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rol_permisos (
  rol_id INT UNSIGNED NOT NULL,
  permiso_codigo VARCHAR(60) NOT NULL,
  PRIMARY KEY (rol_id, permiso_codigo),
  CONSTRAINT fk_rol_permisos_rol FOREIGN KEY (rol_id) REFERENCES roles (id),
  CONSTRAINT fk_rol_permisos_permiso FOREIGN KEY (permiso_codigo) REFERENCES permisos (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesiones listables y revocables: el token solo existe en el navegador; aquí se guarda su huella.
CREATE TABLE sesiones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  huella_token CHAR(64) NOT NULL,
  dispositivo VARCHAR(255) NULL,
  ip VARCHAR(45) NULL,
  vence_en DATETIME NOT NULL,
  revocada_en DATETIME NULL,
  es_soporte TINYINT(1) NOT NULL DEFAULT 0,
  ultimo_uso DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesiones_huella (huella_token),
  KEY ix_sesiones_usuario (usuario_id, revocada_en),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tokens_recuperacion (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  huella CHAR(64) NOT NULL,
  vence_en DATETIME NOT NULL,
  usado_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_recuperacion_huella (huella),
  KEY ix_tokens_recuperacion_usuario (usuario_id),
  CONSTRAINT fk_tokens_recuperacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Catálogo de permisos de la Fase 3 (las fases siguientes agregan los suyos con migraciones nuevas) ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('configuracion.ver',        'base',      'VER LA CONFIGURACION DEL TALLER'),
  ('configuracion.editar',     'base',      'CAMBIAR LA CONFIGURACION DEL TALLER'),
  ('colaboradores.ver',        'base',      'VER COLABORADORES'),
  ('colaboradores.crear',      'base',      'CREAR COLABORADORES'),
  ('colaboradores.editar',     'base',      'EDITAR COLABORADORES'),
  ('colaboradores.desactivar', 'base',      'DESACTIVAR Y REACTIVAR COLABORADORES'),
  ('usuarios.gestionar',       'base',      'DAR ACCESO, ASIGNAR ROLES Y RESTABLECER CONTRASENAS'),
  ('roles.ver',                'base',      'VER ROLES Y PERMISOS'),
  ('roles.gestionar',          'base',      'CREAR Y EDITAR ROLES Y SUS PERMISOS'),
  ('sucursales.ver',           'base',      'VER SUCURSALES'),
  ('sucursales.gestionar',     'base',      'CREAR Y EDITAR SUCURSALES'),
  ('areas.ver',                'base',      'VER AREAS DE TRABAJO'),
  ('areas.gestionar',          'base',      'CREAR Y EDITAR AREAS DE TRABAJO'),
  ('bitacora.ver',             'base',      'VER LA BITACORA'),
  ('suscripcion.ver',          'base',      'VER SUSCRIPCION Y PAGOS'),
  ('suscripcion.cancelar',     'base',      'CANCELAR LA SUSCRIPCION'),
  ('datos.exportar',           'base',      'EXPORTAR LOS DATOS DEL TALLER'),
  ('datos.importar',           'equipos',   'CARGAR DATOS EN MASA DESDE EXCEL'),
  ('bodegas.ver',              'inventario','VER BODEGAS'),
  ('bodegas.gestionar',        'inventario','CREAR Y EDITAR BODEGAS'),
  ('catalogos.ver',            'ordenes',   'VER CATALOGOS DE TRABAJO'),
  ('catalogos.gestionar',      'ordenes',   'CREAR Y EDITAR CATALOGOS DE TRABAJO'),
  ('clientes.ver',             'clientes',  'VER CLIENTES'),
  ('clientes.crear',           'clientes',  'CREAR CLIENTES'),
  ('clientes.editar',          'clientes',  'EDITAR CLIENTES'),
  ('clientes.desactivar',      'clientes',  'DESACTIVAR Y REACTIVAR CLIENTES'),
  ('proveedores.ver',          'clientes',  'VER PROVEEDORES'),
  ('proveedores.crear',        'clientes',  'CREAR PROVEEDORES'),
  ('proveedores.editar',       'clientes',  'EDITAR PROVEEDORES'),
  ('proveedores.desactivar',   'clientes',  'DESACTIVAR Y REACTIVAR PROVEEDORES'),
  ('tipos_equipo.ver',         'equipos',   'VER TIPOS DE EQUIPO'),
  ('tipos_equipo.gestionar',   'equipos',   'CREAR Y EDITAR TIPOS DE EQUIPO'),
  ('equipos.ver',              'equipos',   'VER EQUIPOS'),
  ('equipos.crear',            'equipos',   'CREAR EQUIPOS'),
  ('equipos.editar',           'equipos',   'EDITAR EQUIPOS'),
  ('equipos.desactivar',       'equipos',   'DESACTIVAR Y REACTIVAR EQUIPOS'),
  ('contadores.ver',           'equipos',   'VER CONTADORES Y LECTURAS'),
  ('contadores.registrar',     'equipos',   'REGISTRAR LECTURAS DE CONTADOR'),
  ('contadores.anular',        'equipos',   'ANULAR LECTURAS DE CONTADOR'),
  ('contadores.gestionar',     'equipos',   'CREAR Y EDITAR CONTADORES');

-- Administrador: todo.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'administrador';

-- Gerente: todo menos administrar roles, accesos y la suscripción.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'gerente' AND p.codigo NOT IN ('roles.gestionar', 'usuarios.gestionar', 'suscripcion.cancelar');

-- Supervisor: ve todo lo operativo y coordina equipos, clientes y contadores.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'supervisor'
   AND (p.codigo IN ('clientes.crear', 'clientes.editar', 'equipos.crear', 'equipos.editar', 'contadores.registrar', 'contadores.anular')
        OR (p.codigo LIKE '%.ver' AND p.codigo NOT IN ('roles.ver', 'bitacora.ver', 'suscripcion.ver', 'configuracion.ver')));

-- Recepcionista: atiende clientes y registra equipos y lecturas.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'recepcionista'
   AND p.codigo IN ('clientes.ver', 'clientes.crear', 'clientes.editar', 'proveedores.ver', 'equipos.ver', 'equipos.crear', 'equipos.editar',
                    'tipos_equipo.ver', 'contadores.ver', 'contadores.registrar', 'sucursales.ver', 'areas.ver', 'catalogos.ver');

-- Técnico y operador: consultan equipos y registran lecturas.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo IN ('tecnico', 'operador')
   AND p.codigo IN ('equipos.ver', 'tipos_equipo.ver', 'contadores.ver', 'contadores.registrar', 'clientes.ver', 'catalogos.ver');

-- Bodeguero: consulta lo que necesita para despachar.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'bodeguero' AND p.codigo IN ('equipos.ver', 'tipos_equipo.ver', 'bodegas.ver', 'catalogos.ver', 'clientes.ver');

-- Visualizador: solo consulta (sin datos sensibles del taller).
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'visualizador'
   AND p.codigo LIKE '%.ver' AND p.codigo NOT IN ('roles.ver', 'bitacora.ver', 'suscripcion.ver', 'configuracion.ver', 'colaboradores.ver');
