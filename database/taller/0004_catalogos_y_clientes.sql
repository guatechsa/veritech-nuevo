-- Taller, migración 0004: catálogos de trabajo, tipos de cliente, clientes, contactos y proveedores (Fase 3c).
-- Textos de fábrica en MAYÚSCULAS sin tildes (estándar §5). Las horas por tipo de equipo de cada trabajo llegan con los tipos de equipo (3d).

-- ── Jerarquía técnica: Sistema → Subsistema → Parte → Trabajo (Trabajo = Parte × Acción × correlativo) ──
CREATE TABLE sistemas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(2) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  es_servicios_programados TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'sus trabajos son los que se programan por contador o calendario',
  es_insumos_generales TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'grupo de insumos sin clasificación técnica (el 99 de fábrica)',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sistemas_codigo (codigo),
  UNIQUE KEY uq_sistemas_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sistemas (codigo, nombre, es_servicios_programados, es_insumos_generales) VALUES
  ('00', 'SERVICIOS PROGRAMADOS', 1, 0),
  ('99', 'INSUMOS GENERALES', 0, 1);

CREATE TABLE subsistemas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sistema_id INT UNSIGNED NOT NULL,
  codigo VARCHAR(2) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subsistemas_codigo (sistema_id, codigo),
  UNIQUE KEY uq_subsistemas_nombre (sistema_id, nombre),
  CONSTRAINT fk_subsistemas_sistema FOREIGN KEY (sistema_id) REFERENCES sistemas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE partes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subsistema_id INT UNSIGNED NOT NULL,
  codigo VARCHAR(2) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_partes_codigo (subsistema_id, codigo),
  UNIQUE KEY uq_partes_nombre (subsistema_id, nombre),
  CONSTRAINT fk_partes_subsistema FOREIGN KEY (subsistema_id) REFERENCES subsistemas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE acciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(3) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acciones_codigo (codigo),
  UNIQUE KEY uq_acciones_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO acciones (codigo, nombre) VALUES
  ('CAM', 'CAMBIAR'), ('REV', 'REVISAR'), ('REP', 'REPARAR'), ('INS', 'INSTALAR'), ('AJU', 'AJUSTAR'),
  ('LIM', 'LIMPIAR'), ('LUB', 'LUBRICAR'), ('DIA', 'DIAGNOSTICAR'), ('DES', 'DESMONTAR'), ('ARM', 'ARMAR');

CREATE TABLE trabajos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  parte_id INT UNSIGNED NOT NULL,
  accion_id INT UNSIGNED NOT NULL,
  correlativo SMALLINT UNSIGNED NOT NULL,
  codigo VARCHAR(20) NOT NULL COMMENT '<sistema>-<subsistema>-<parte>-<acción>-<correlativo>, se arma solo',
  nombre VARCHAR(220) NOT NULL,
  variante VARCHAR(100) NULL,
  area_trabajo_id INT UNSIGNED NULL COMMENT 'nulo = trabajo general',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trabajos_codigo (codigo),
  UNIQUE KEY uq_trabajos_clave (parte_id, accion_id, correlativo),
  KEY ix_trabajos_nombre (nombre),
  CONSTRAINT fk_trabajos_parte FOREIGN KEY (parte_id) REFERENCES partes (id),
  CONSTRAINT fk_trabajos_accion FOREIGN KEY (accion_id) REFERENCES acciones (id),
  CONSTRAINT fk_trabajos_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Matriz nivel de técnico × sistema: UNA sola regla, explícita (decisión del módulo 7). Fila ausente = SIN permiso.
-- Al crear un sistema o un nivel nuevo, sus filas se crean todas habilitadas.
CREATE TABLE matriz_tecnico_sistema (
  nivel_tecnico_id INT UNSIGNED NOT NULL,
  sistema_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (nivel_tecnico_id, sistema_id),
  CONSTRAINT fk_matriz_nivel FOREIGN KEY (nivel_tecnico_id) REFERENCES niveles_tecnico (id),
  CONSTRAINT fk_matriz_sistema FOREIGN KEY (sistema_id) REFERENCES sistemas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO matriz_tecnico_sistema (nivel_tecnico_id, sistema_id) SELECT n.id, s.id FROM niveles_tecnico n JOIN sistemas s;

-- ── Catálogos simples ──
-- Un solo catálogo de unidades (decisión del módulo 1): "uso" dice dónde aparece.
CREATE TABLE unidades (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(10) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  uso ENUM('inventario','contador','ambos') NOT NULL DEFAULT 'inventario',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unidades_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO unidades (codigo, nombre, uso) VALUES
  ('UND', 'UNIDAD', 'inventario'), ('PAR', 'PAR', 'inventario'), ('JGO', 'JUEGO', 'inventario'), ('LT', 'LITRO', 'inventario'),
  ('GAL', 'GALON', 'inventario'), ('KG', 'KILOGRAMO', 'inventario'), ('LB', 'LIBRA', 'inventario'), ('MT', 'METRO', 'inventario'), ('CM', 'CENTIMETRO', 'inventario'),
  ('KM', 'KILOMETROS', 'contador'), ('MI', 'MILLAS', 'contador'), ('HRS', 'HORAS', 'contador'), ('CICL', 'CICLOS', 'contador'),
  ('DIAS', 'DIAS', 'contador'), ('MESES', 'MESES', 'contador');

-- Marcas: generales (tipo_equipo_id nulo) o de un tipo de equipo; el enlace al tipo se completa en la Fase 3d.
CREATE TABLE marcas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  tipo_equipo_id INT UNSIGNED NULL,
  clave_tipo INT UNSIGNED GENERATED ALWAYS AS (IFNULL(tipo_equipo_id, 0)) STORED,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marcas_nombre (nombre, clave_tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tipos de orden configurables; uno es el "por defecto"; "pedido especial" nace sin equipo presente.
CREATE TABLE tipos_orden (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(3) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  es_default TINYINT(1) NOT NULL DEFAULT 0,
  es_pedido_especial TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_orden_codigo (codigo),
  UNIQUE KEY uq_tipos_orden_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tipos_orden (codigo, nombre, es_default, es_pedido_especial) VALUES
  ('REP', 'REPARACION', 1, 0), ('MAN', 'MANTENIMIENTO', 0, 0), ('DIA', 'DIAGNOSTICO', 0, 0), ('INS', 'INSPECCION', 0, 0),
  ('GAR', 'GARANTIA', 0, 0), ('MPE', 'MATERIAL PENDIENTE', 0, 1);

-- Estados de la orden: los 7 de fábrica no se borran (sí se renombran); la lógica solo mira las banderas, nunca el texto.
CREATE TABLE estados_orden (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  es_inicial TINYINT(1) NOT NULL DEFAULT 0,
  es_terminal TINYINT(1) NOT NULL DEFAULT 0,
  es_cancelado TINYINT(1) NOT NULL DEFAULT 0,
  es_sistema TINYINT(1) NOT NULL DEFAULT 0,
  color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estados_orden_codigo (codigo),
  UNIQUE KEY uq_estados_orden_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO estados_orden (codigo, nombre, orden, es_inicial, es_terminal, es_cancelado, es_sistema, color) VALUES
  ('CREADA', 'CREADA', 10, 1, 0, 0, 1, '#6B7280'),
  ('EN_PROCESO', 'EN PROCESO', 20, 0, 0, 0, 1, '#4997D0'),
  ('EN_REVISION', 'EN REVISION', 30, 0, 0, 0, 1, '#D97706'),
  ('TERMINADA', 'TERMINADA', 40, 0, 0, 0, 1, '#059669'),
  ('ENTREGADA', 'ENTREGADA', 50, 0, 0, 0, 1, '#0D9488'),
  ('CERRADA', 'CERRADA', 60, 0, 1, 0, 1, '#374151'),
  ('ANULADA', 'ANULADA', 70, 0, 1, 1, 1, '#DC2626');

-- Etapas de los checklists (qué momento del trabajo cubren).
CREATE TABLE etapas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  requiere_orden TINYINT(1) NOT NULL DEFAULT 1,
  color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_etapas_codigo (codigo),
  UNIQUE KEY uq_etapas_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO etapas (codigo, nombre, orden, requiere_orden, color) VALUES
  ('RECEPCION', 'RECEPCION', 10, 1, '#4997D0'), ('CALIDAD', 'CALIDAD', 20, 1, '#D97706'), ('ENTREGA', 'ENTREGA', 30, 1, '#059669');

-- Motivos que se piden al anular, rechazar o excepcionar (con motivo siempre).
CREATE TABLE motivos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo ENUM('rechazo_cotizacion','cancelacion_cita','anulacion_orden','diferencia_inventario','excepcion_checklist') NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_motivos_nombre (tipo, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO motivos (tipo, nombre) VALUES
  ('rechazo_cotizacion', 'PRECIO MUY ALTO'), ('rechazo_cotizacion', 'NO NECESITA EL TRABAJO'), ('rechazo_cotizacion', 'TIEMPO DE ENTREGA'), ('rechazo_cotizacion', 'LO HARA CON OTRO TALLER'),
  ('cancelacion_cita', 'EL CLIENTE CANCELO'), ('cancelacion_cita', 'EL TALLER NO PUEDE ATENDER'), ('cancelacion_cita', 'EQUIPO NO DISPONIBLE'),
  ('anulacion_orden', 'CREADA POR ERROR'), ('anulacion_orden', 'EL CLIENTE DESISTIO'), ('anulacion_orden', 'DUPLICADA'),
  ('diferencia_inventario', 'CONTEO FISICO'), ('diferencia_inventario', 'MERMA'), ('diferencia_inventario', 'ERROR DE REGISTRO'),
  ('excepcion_checklist', 'EQUIPO FUERA DE SERVICIO'), ('excepcion_checklist', 'AUTORIZADO POR GERENCIA');

-- ── Clientes, contactos y proveedores (campos del estándar GUATECH §4) ──
CREATE TABLE tipos_cliente (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  descuento_trabajos DECIMAL(5,2) NOT NULL DEFAULT 0,
  descuento_materiales DECIMAL(5,2) NOT NULL DEFAULT 0,
  descuento_otros DECIMAL(5,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_cliente_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tipos_cliente (nombre) VALUES ('GENERAL');

CREATE TABLE clientes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  nit VARCHAR(30) NULL,
  nit_unico VARCHAR(30) GENERATED ALWAYS AS (IF(nit IS NULL OR nit = 'CF', NULL, nit)) STORED COMMENT 'el NIT es único salvo CF (consumidor final)',
  contacto_nombre VARCHAR(120) NULL,
  contacto_email VARCHAR(150) NULL,
  contacto_telefono VARCHAR(40) NULL,
  telefono VARCHAR(40) NULL,
  email VARCHAR(150) NULL,
  direccion VARCHAR(250) NULL,
  condicion_pago ENUM('contado','credito') NOT NULL DEFAULT 'contado',
  dias_credito SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  limite_credito DECIMAL(12,2) NOT NULL DEFAULT 0,
  notas VARCHAR(500) NULL,
  tipo_cliente_id INT UNSIGNED NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_nit (nit_unico),
  KEY ix_clientes_nombre (nombre),
  KEY ix_clientes_email (email),
  KEY ix_clientes_telefono (telefono),
  CONSTRAINT fk_clientes_tipo FOREIGN KEY (tipo_cliente_id) REFERENCES tipos_cliente (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Áreas internas DEL CLIENTE (Producción, Empaque…), para agrupar sus equipos. No son las áreas de trabajo del taller.
CREATE TABLE departamentos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departamentos_nombre (cliente_id, nombre),
  CONSTRAINT fk_departamentos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las personas del cliente que se relacionan con el taller (aprueban trabajos, consultan el portal, manejan el equipo).
-- El acceso por equipo (contacto_equipos) llega con los equipos en la Fase 3d.
CREATE TABLE contactos_cliente (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(150) NULL,
  telefono VARCHAR(40) NULL,
  rol ENUM('aprobador','consulta','piloto') NOT NULL DEFAULT 'consulta',
  acceso_todos_equipos TINYINT(1) NOT NULL DEFAULT 1,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_contactos_cliente_cliente (cliente_id),
  KEY ix_contactos_cliente_correo (correo),
  CONSTRAINT fk_contactos_cliente_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE proveedores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  nit VARCHAR(30) NULL,
  contacto_nombre VARCHAR(120) NULL,
  contacto_email VARCHAR(150) NULL,
  contacto_telefono VARCHAR(40) NULL,
  direccion VARCHAR(250) NULL,
  condicion_pago ENUM('contado','credito') NOT NULL DEFAULT 'contado',
  dias_credito SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  notas VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_proveedores_nombre (nombre),
  KEY ix_proveedores_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
