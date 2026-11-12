-- Fase 6a: cotizaciones. Un documento con líneas de trabajos, materiales y trabajos con terceros; el cliente (o quien lo represente)
-- autoriza o rechaza CADA línea. Los rojos de los checklists se anotan como «hallazgos» del borrador; el desenlace de cada rojo vive en las líneas.

CREATE TABLE cotizaciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT 'COT-000001; las versiones nuevas conservan el número',
  version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  reemplaza_a_id INT UNSIGNED NULL,
  cliente_id INT UNSIGNED NULL COMMENT 'vacío en la flota propia',
  equipo_id INT UNSIGNED NULL,
  orden_id INT UNSIGNED NULL,
  checklist_id INT UNSIGNED NULL COMMENT 'el checklist de donde salieron los rojos',
  estado ENUM('borrador','enviada','respondida','vencida','reemplazada','anulada') NOT NULL DEFAULT 'borrador',
  notas VARCHAR(500) NULL COMMENT 'lo ve el cliente',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  vence_en DATE NULL,
  enviada_en DATETIME NULL,
  creada_por_id INT UNSIGNED NULL,
  anulada_en DATETIME NULL,
  anulada_por_id INT UNSIGNED NULL,
  motivo_anulacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cotizaciones_numero (numero, version),
  KEY ix_cotizaciones_estado (estado, vence_en),
  KEY ix_cotizaciones_orden (orden_id),
  KEY ix_cotizaciones_equipo (equipo_id),
  KEY ix_cotizaciones_cliente (cliente_id),
  CONSTRAINT fk_cotizaciones_reemplaza FOREIGN KEY (reemplaza_a_id) REFERENCES cotizaciones (id),
  CONSTRAINT fk_cotizaciones_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_cotizaciones_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_cotizaciones_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_cotizaciones_checklist FOREIGN KEY (checklist_id) REFERENCES checklists (id),
  CONSTRAINT fk_cotizaciones_creada_por FOREIGN KEY (creada_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_cotizaciones_anulada_por FOREIGN KEY (anulada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los rojos (respuestas de checklist) que esta cotización atiende. Las respuestas del checklist no cambian nunca.
CREATE TABLE cotizacion_hallazgos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cotizacion_id INT UNSIGNED NOT NULL,
  respuesta_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cotizacion_hallazgos (cotizacion_id, respuesta_id),
  KEY ix_cotizacion_hallazgos_respuesta (respuesta_id),
  CONSTRAINT fk_cotizacion_hallazgos_cot FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id),
  CONSTRAINT fk_cotizacion_hallazgos_respuesta FOREIGN KEY (respuesta_id) REFERENCES checklist_respuestas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cotizacion_lineas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cotizacion_id INT UNSIGNED NOT NULL,
  tipo ENUM('servicio','material','tercero') NOT NULL,
  respuesta_id INT UNSIGNED NULL COMMENT 'el rojo de origen',
  trabajo_id INT UNSIGNED NULL,
  material_id INT UNSIGNED NULL,
  proveedor_id INT UNSIGNED NULL,
  descripcion VARCHAR(250) NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  total_linea DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'lo que cuesta al taller: interno, el cliente no lo ve',
  horas DECIMAL(6,2) NULL,
  tarifa_hora_aplicada DECIMAL(10,2) NULL,
  costo_hora_aplicado DECIMAL(10,2) NULL,
  area_trabajo_id INT UNSIGNED NULL,
  estado ENUM('pendiente','autorizada','rechazada','agregada_a_orden','vencida') NOT NULL DEFAULT 'pendiente',
  motivo_rechazo_id INT UNSIGNED NULL,
  motivo_rechazo_texto VARCHAR(300) NULL,
  respondida_en DATETIME NULL,
  respondida_por_usuario_id INT UNSIGNED NULL COMMENT 'quien lo registró a nombre del cliente (llamada, en persona)',
  dispositivo VARCHAR(200) NULL,
  ip VARCHAR(64) NULL,
  linea_orden_id INT UNSIGNED NULL COMMENT 'la línea de la orden en que se convirtió (servicios y terceros)',
  solicitud_id INT UNSIGNED NULL COMMENT 'la solicitud de material en que se convirtió (materiales)',
  agregada_orden_id INT UNSIGNED NULL,
  agregada_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cotizacion_lineas (cotizacion_id, id),
  KEY ix_cotizacion_lineas_respuesta (respuesta_id),
  CONSTRAINT fk_cotizacion_lineas_cot FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id),
  CONSTRAINT fk_cotizacion_lineas_respuesta FOREIGN KEY (respuesta_id) REFERENCES checklist_respuestas (id),
  CONSTRAINT fk_cotizacion_lineas_trabajo FOREIGN KEY (trabajo_id) REFERENCES trabajos (id),
  CONSTRAINT fk_cotizacion_lineas_material FOREIGN KEY (material_id) REFERENCES materiales (id),
  CONSTRAINT fk_cotizacion_lineas_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  CONSTRAINT fk_cotizacion_lineas_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id),
  CONSTRAINT fk_cotizacion_lineas_motivo FOREIGN KEY (motivo_rechazo_id) REFERENCES motivos (id),
  CONSTRAINT fk_cotizacion_lineas_usuario FOREIGN KEY (respondida_por_usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_cotizacion_lineas_linea_orden FOREIGN KEY (linea_orden_id) REFERENCES lineas_orden (id),
  CONSTRAINT fk_cotizacion_lineas_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes_material (id),
  CONSTRAINT fk_cotizacion_lineas_agregada FOREIGN KEY (agregada_orden_id) REFERENCES ordenes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Motivos de rechazo que pidió Luis: precio, repuesto no disponible, tiempo, otro.
INSERT INTO motivos (tipo, nombre) VALUES ('rechazo_cotizacion', 'REPUESTO NO DISPONIBLE'), ('rechazo_cotizacion', 'OTRO');

-- ── Permisos ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('cotizaciones.ver',       'cotizaciones', 'VER COTIZACIONES'),
  ('cotizaciones.crear',     'cotizaciones', 'COTIZAR: CREAR, EDITAR, ENVIAR Y ANULAR COTIZACIONES'),
  ('cotizaciones.responder', 'cotizaciones', 'REGISTRAR SI EL CLIENTE AUTORIZA O RECHAZA CADA LINEA (O AUTORIZAR EN FLOTA PROPIA)');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'cotizaciones.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('supervisor', 'recepcionista') AND p.codigo LIKE 'cotizaciones.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'cotizaciones.ver' FROM roles r WHERE r.codigo = 'visualizador';
