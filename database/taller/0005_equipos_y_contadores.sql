-- Taller, migración 0005: archivos, tipos de equipo, equipos y contadores con lecturas (Fase 3d).

-- Todo archivo (foto, documento, firma, PDF) se registra UNA vez aquí y las demás tablas apuntan a él.
-- `ruta` es relativa a la carpeta del taller en el servidor; nunca se muestra: se entrega con una dirección firmada que vence.
CREATE TABLE archivos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ruta VARCHAR(190) NOT NULL,
  nombre_original VARCHAR(190) NOT NULL,
  tipo_mime VARCHAR(60) NOT NULL,
  tamano INT UNSIGNED NOT NULL,
  hash CHAR(64) NOT NULL,
  subido_por INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_archivos_ruta (ruta),
  KEY ix_archivos_hash (hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El tipo de equipo es el centro: manda sobre tarifas, servicios y KPIs. La placa solo se pide a los vehículos y el
-- combustible solo a quien lo usa (decisiones del módulo 4).
CREATE TABLE tipos_equipo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  es_vehiculo TINYINT(1) NOT NULL DEFAULT 0,
  usa_combustible TINYINT(1) NOT NULL DEFAULT 0,
  tarifa_venta_hora DECIMAL(10,2) NOT NULL DEFAULT 0,
  costo_hora DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'lo que le cuesta al taller: interno, nunca se muestra al cliente',
  tolerancia_dias SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tolerancia_contador DECIMAL(12,2) NOT NULL DEFAULT 0,
  tiene_componentes TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_equipo_codigo (codigo),
  UNIQUE KEY uq_tipos_equipo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tipos_equipo (codigo, nombre, es_vehiculo, usa_combustible) VALUES
  ('VEHICULO', 'VEHICULO', 1, 1), ('MAQUINARIA', 'MAQUINARIA', 0, 1), ('EQUIPO', 'EQUIPO GENERAL', 0, 0);

-- Las marcas pueden ser de un tipo de equipo (o generales, con tipo nulo).
ALTER TABLE marcas ADD CONSTRAINT fk_marcas_tipo_equipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id);

-- Horas estándar de cada trabajo para cada tipo de equipo (precio de la línea = horas × tarifa por hora).
CREATE TABLE trabajo_horas_tipo_equipo (
  trabajo_id INT UNSIGNED NOT NULL,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  horas DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (trabajo_id, tipo_equipo_id),
  CONSTRAINT fk_trabajo_horas_trabajo FOREIGN KEY (trabajo_id) REFERENCES trabajos (id),
  CONSTRAINT fk_trabajo_horas_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Contadores ──
CREATE TABLE tipos_contador (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  unidad_id INT UNSIGNED NOT NULL,
  es_calendario TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'cuenta días desde su fecha de inicio: no se le registran lecturas',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_contador_nombre (nombre),
  CONSTRAINT fk_tipos_contador_unidad FOREIGN KEY (unidad_id) REFERENCES unidades (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tipos_contador (nombre, unidad_id, es_calendario)
SELECT 'ODOMETRO', id, 0 FROM unidades WHERE codigo = 'KM'
UNION ALL SELECT 'HOROMETRO', id, 0 FROM unidades WHERE codigo = 'HRS'
UNION ALL SELECT 'CALENDARIO', id, 1 FROM unidades WHERE codigo = 'DIAS';

-- ── Documentos requeridos por tipo de equipo (seguro, tarjeta de circulación, manual…) ──
CREATE TABLE tipos_documento (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  requiere_vencimiento TINYINT(1) NOT NULL DEFAULT 0,
  dias_aviso SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_documento_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tipos_documento (nombre, requiere_vencimiento, dias_aviso) VALUES
  ('SEGURO', 1, 30), ('TARJETA DE CIRCULACION', 1, 30), ('CALCOMANIA', 1, 30), ('MANUAL DE OPERACION', 0, 0), ('GARANTIA', 1, 60), ('FACTURA DE COMPRA', 0, 0);

CREATE TABLE tipo_equipo_documentos (
  tipo_equipo_id INT UNSIGNED NOT NULL,
  tipo_documento_id INT UNSIGNED NOT NULL,
  obligatorio TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (tipo_equipo_id, tipo_documento_id),
  CONSTRAINT fk_tipo_equipo_documentos_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id),
  CONSTRAINT fk_tipo_equipo_documentos_documento FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plantilla de componentes (solo para los tipos que "tienen componentes"): se copia al crear cada equipo.
CREATE TABLE tipo_equipo_componentes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  tipo_contador_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipo_equipo_componentes (tipo_equipo_id, nombre),
  CONSTRAINT fk_tipo_equipo_componentes_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id),
  CONSTRAINT fk_tipo_equipo_componentes_contador FOREIGN KEY (tipo_contador_id) REFERENCES tipos_contador (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Equipos ──
-- La llave es el número automático (id); el código interno del cliente es opcional y único por cliente; la serie es opcional
-- y única si se escribe; la placa solo si el tipo es vehículo (se advierte, no se bloquea, si se repite).
CREATE TABLE equipos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  codigo_interno VARCHAR(40) NULL,
  placa VARCHAR(20) NULL,
  serie VARCHAR(60) NULL,
  marca_id INT UNSIGNED NULL,
  modelo VARCHAR(80) NULL,
  anio SMALLINT UNSIGNED NULL,
  color VARCHAR(40) NULL,
  motor_marca VARCHAR(60) NULL,
  motor_modelo VARCHAR(60) NULL,
  motor_serie VARCHAR(60) NULL,
  combustible VARCHAR(30) NULL,
  capacidad_tanque DECIMAL(8,2) NULL,
  cliente_id INT UNSIGNED NULL COMMENT 'nulo solo si el equipo es propio del taller',
  departamento_id INT UNSIGNED NULL,
  propiedad ENUM('propio','cliente') NOT NULL DEFAULT 'cliente',
  estado ENUM('activo','fuera_de_servicio','baja') NOT NULL DEFAULT 'activo',
  codigo_publico CHAR(16) NOT NULL COMMENT 'identifica al equipo en el QR sin mostrar el número de empresa ni el id',
  notas VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  clave_codigo VARCHAR(60) GENERATED ALWAYS AS (IF(codigo_interno IS NULL, NULL, CONCAT(IFNULL(cliente_id, 0), ':', codigo_interno))) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipos_codigo_publico (codigo_publico),
  UNIQUE KEY uq_equipos_serie (serie),
  UNIQUE KEY uq_equipos_codigo_interno (clave_codigo),
  KEY ix_equipos_cliente (cliente_id),
  KEY ix_equipos_tipo (tipo_equipo_id),
  KEY ix_equipos_placa (placa),
  CONSTRAINT fk_equipos_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id),
  CONSTRAINT fk_equipos_marca FOREIGN KEY (marca_id) REFERENCES marcas (id),
  CONSTRAINT fk_equipos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_equipos_departamento FOREIGN KEY (departamento_id) REFERENCES departamentos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contacto_equipos (
  contacto_id INT UNSIGNED NOT NULL,
  equipo_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (contacto_id, equipo_id),
  CONSTRAINT fk_contacto_equipos_contacto FOREIGN KEY (contacto_id) REFERENCES contactos_cliente (id),
  CONSTRAINT fk_contacto_equipos_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Componentes" (antes "sub-equipos"): partes del equipo con su propio contador (por ejemplo, el motor de una cosechadora).
CREATE TABLE componentes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_componentes_nombre (equipo_id, nombre),
  CONSTRAINT fk_componentes_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipo_documentos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  tipo_documento_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(150) NULL,
  vence DATE NULL,
  archivo_id INT UNSIGNED NULL,
  subido_por INT UNSIGNED NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_equipo_documentos_equipo (equipo_id, activo),
  KEY ix_equipo_documentos_vence (vence),
  CONSTRAINT fk_equipo_documentos_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_equipo_documentos_tipo FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento (id),
  CONSTRAINT fk_equipo_documentos_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipo_fotos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  archivo_id INT UNSIGNED NOT NULL,
  descripcion VARCHAR(150) NULL,
  es_principal TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_equipo_fotos_equipo (equipo_id),
  CONSTRAINT fk_equipo_fotos_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_equipo_fotos_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipo_notas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  nota VARCHAR(1000) NOT NULL,
  es_importante TINYINT(1) NOT NULL DEFAULT 0,
  creado_por INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_equipo_notas_equipo (equipo_id),
  CONSTRAINT fk_equipo_notas_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quién maneja cada equipo (colaboradores con un puesto de operador).
CREATE TABLE asignaciones_operador (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  colaborador_id INT UNSIGNED NOT NULL,
  equipo_id INT UNSIGNED NOT NULL,
  desde DATE NOT NULL,
  hasta DATE NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_asignaciones_operador_equipo (equipo_id, activo),
  KEY ix_asignaciones_operador_colaborador (colaborador_id, activo),
  CONSTRAINT fk_asignaciones_operador_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id),
  CONSTRAINT fk_asignaciones_operador_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los medidores nunca se reinician; el valor vigente sale de la última lectura válida.
CREATE TABLE contadores (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  componente_id INT UNSIGNED NULL,
  tipo_contador_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  valor_inicial DECIMAL(12,2) NOT NULL DEFAULT 0,
  valor_actual DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha_inicio DATE NOT NULL,
  ultima_lectura_en DATE NULL,
  es_principal TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_contadores_equipo (equipo_id, activo),
  CONSTRAINT fk_contadores_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_contadores_componente FOREIGN KEY (componente_id) REFERENCES componentes (id),
  CONSTRAINT fk_contadores_tipo FOREIGN KEY (tipo_contador_id) REFERENCES tipos_contador (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una lectura equivocada NO se borra: se ANULA con motivo, quién y cuándo, y el contador toma la mejor lectura vigente.
CREATE TABLE lecturas_contador (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contador_id INT UNSIGNED NOT NULL,
  valor DECIMAL(12,2) NOT NULL,
  fecha DATE NOT NULL,
  origen ENUM('inicial','orden','checklist','manual','portal','cita','importacion') NOT NULL DEFAULT 'manual',
  orden_id INT UNSIGNED NULL,
  checklist_id INT UNSIGNED NULL,
  registrado_por INT UNSIGNED NULL,
  registrado_por_contacto_id INT UNSIGNED NULL,
  archivo_id INT UNSIGNED NULL,
  notas VARCHAR(300) NULL,
  estado ENUM('valida','pendiente_revision','anulada') NOT NULL DEFAULT 'valida',
  anulada_en DATETIME NULL,
  anulada_por INT UNSIGNED NULL,
  motivo_anulacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_lecturas_contador (contador_id, estado, fecha, id),
  CONSTRAINT fk_lecturas_contador FOREIGN KEY (contador_id) REFERENCES contadores (id),
  CONSTRAINT fk_lecturas_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
