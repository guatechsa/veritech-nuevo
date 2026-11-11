-- Taller, migración 0001: lo mínimo que el alta necesita escribir (áreas A y B del diseño).
-- El resto del taller (permisos, catálogos, clientes, equipos, órdenes…) llega en la Fase 3 con migraciones nuevas.
-- Horas de negocio en UTC (DATETIME); created_at/updated_at son TIMESTAMP y las conexiones trabajan en UTC.

CREATE TABLE niveles_tecnico (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_niveles_tecnico_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO niveles_tecnico (codigo, nombre, orden) VALUES ('N1', 'NIVEL 1', 1), ('N2', 'NIVEL 2', 2), ('N3', 'NIVEL 3', 3);

CREATE TABLE sucursales (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  direccion VARCHAR(200) NULL,
  telefono VARCHAR(30) NULL,
  es_principal TINYINT(1) NOT NULL DEFAULT 0,
  cupo_diario_citas SMALLINT UNSIGNED NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sucursales_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE areas_trabajo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_areas_trabajo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE colaboradores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NULL,
  nombre_completo VARCHAR(150) NOT NULL,
  correo VARCHAR(150) NULL,
  celular VARCHAR(30) NULL,
  direccion VARCHAR(200) NULL,
  dpi VARCHAR(20) NULL,
  sucursal_id INT UNSIGNED NULL,
  area_trabajo_id INT UNSIGNED NULL,
  nivel_tecnico_id INT UNSIGNED NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_colaboradores_correo (correo),
  UNIQUE KEY uq_colaboradores_codigo (codigo),
  CONSTRAINT fk_colaboradores_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id),
  CONSTRAINT fk_colaboradores_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id),
  CONSTRAINT fk_colaboradores_nivel FOREIGN KEY (nivel_tecnico_id) REFERENCES niveles_tecnico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El usuario nace de un colaborador: nombre, celular y correo se toman de ahí.
CREATE TABLE usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  colaborador_id INT UNSIGNED NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_ingreso DATETIME NULL,
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_colaborador (colaborador_id),
  CONSTRAINT fk_usuarios_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  descripcion VARCHAR(200) NULL,
  es_sistema TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (codigo, nombre, descripcion, es_sistema) VALUES
  ('administrador', 'ADMINISTRADOR', 'ACCESO TOTAL AL TALLER', 1),
  ('gerente', 'GERENTE', 'VE TODO Y AUTORIZA', 1),
  ('supervisor', 'SUPERVISOR', 'COORDINA EL TRABAJO DEL TALLER', 1),
  ('recepcionista', 'RECEPCIONISTA', 'RECIBE EQUIPOS Y ATIENDE A CLIENTES', 1),
  ('tecnico', 'TECNICO', 'EJECUTA TRABAJOS Y LLENA CHECKLISTS', 1),
  ('operador', 'OPERADOR', 'USA EL EQUIPO Y LLENA CHECKLISTS', 1),
  ('bodeguero', 'BODEGUERO', 'DESPACHA Y RECIBE MATERIALES', 1),
  ('visualizador', 'VISUALIZADOR', 'SOLO CONSULTA', 1);

CREATE TABLE usuario_roles (
  usuario_id INT UNSIGNED NOT NULL,
  rol_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, rol_id),
  CONSTRAINT fk_usuario_roles_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_usuario_roles_rol FOREIGN KEY (rol_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE configuracion (
  clave VARCHAR(60) NOT NULL,
  valor TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Numeración con bloqueo (nunca MAX()+1).
CREATE TABLE secuencias (
  clave VARCHAR(40) NOT NULL,
  ultimo_valor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bitacora (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NULL,
  accion VARCHAR(60) NOT NULL,
  entidad VARCHAR(60) NULL,
  entidad_id BIGINT UNSIGNED NULL,
  motivo VARCHAR(300) NULL,
  antes TEXT NULL,
  despues TEXT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_bitacora_entidad (entidad, entidad_id),
  KEY ix_bitacora_fecha (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
