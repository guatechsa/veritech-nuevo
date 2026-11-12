-- Fase 5c: reservas con vencimiento y aplicabilidad de los materiales a los equipos.
-- Una reserva protege unidades para UNA orden hasta su vencimiento; se puede reservar aunque hoy no haya existencia.
-- La aplicabilidad dice a qué tipo/marca/modelo de equipo le sirve cada material: se aprende sola al despachar y se puede capturar a mano.

CREATE TABLE reservas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT 'RES-000001',
  orden_id INT UNSIGNED NOT NULL COMMENT 'el cliente y el equipo se toman de la orden',
  estado ENUM('activa','cargada','vencida','cancelada') NOT NULL DEFAULT 'activa',
  vence_en DATE NOT NULL COMMENT 'día del taller: vale hasta el final de ese día',
  extensiones INT UNSIGNED NOT NULL DEFAULT 0,
  motivo_extension VARCHAR(300) NULL,
  notas VARCHAR(300) NULL,
  creada_por_id INT UNSIGNED NULL,
  solicitud_id INT UNSIGNED NULL COMMENT 'la solicitud de despacho que la cubrió',
  cargada_en DATETIME NULL,
  cancelada_en DATETIME NULL,
  cancelada_por_id INT UNSIGNED NULL,
  motivo_cancelacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservas_numero (numero),
  KEY ix_reservas_orden (orden_id),
  KEY ix_reservas_estado (estado, vence_en),
  CONSTRAINT fk_reservas_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_reservas_creada_por FOREIGN KEY (creada_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_reservas_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes_material (id),
  CONSTRAINT fk_reservas_cancelada_por FOREIGN KEY (cancelada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reserva_lineas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reserva_id INT UNSIGNED NOT NULL,
  material_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL,
  cantidad_cubierta INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'lo que ya se despachó a la orden; lo pendiente (cantidad - cubierta) es lo protegido',
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_lineas_material (reserva_id, material_id),
  KEY ix_reserva_lineas_material (material_id),
  CONSTRAINT fk_reserva_lineas_reserva FOREIGN KEY (reserva_id) REFERENCES reservas (id),
  CONSTRAINT fk_reserva_lineas_material FOREIGN KEY (material_id) REFERENCES materiales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE material_aplica_a (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id INT UNSIGNED NOT NULL,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  marca_id INT UNSIGNED NULL COMMENT 'vacío = cualquier marca',
  modelo VARCHAR(60) NULL COMMENT 'vacío = cualquier modelo',
  origen ENUM('consumo','manual') NOT NULL,
  veces INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'cuántas veces se despachó para ese tipo de equipo',
  ultima_vez DATETIME NULL,
  clave VARCHAR(160) AS (CONCAT_WS('|', tipo_equipo_id, COALESCE(marca_id, 0), COALESCE(modelo, ''))) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_material_aplica_a (material_id, clave),
  KEY ix_material_aplica_equipo (tipo_equipo_id, marca_id),
  CONSTRAINT fk_aplica_material FOREIGN KEY (material_id) REFERENCES materiales (id),
  CONSTRAINT fk_aplica_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id),
  CONSTRAINT fk_aplica_marca FOREIGN KEY (marca_id) REFERENCES marcas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permisos ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('reservas.ver',       'inventario', 'VER RESERVAS DE MATERIAL'),
  ('reservas.crear',     'inventario', 'RESERVAR MATERIAL PARA UNA ORDEN'),
  ('reservas.gestionar', 'inventario', 'AMPLIAR O CANCELAR RESERVAS DE OTRAS PERSONAS');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'reservas.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('supervisor', 'recepcionista') AND p.codigo IN ('reservas.ver', 'reservas.crear');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'bodeguero' AND p.codigo IN ('reservas.ver', 'reservas.gestionar');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'reservas.ver' FROM roles r WHERE r.codigo IN ('tecnico', 'operador', 'visualizador');
