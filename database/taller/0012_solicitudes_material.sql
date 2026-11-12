-- Fase 5b: solicitudes de material, despachos a la orden y devoluciones.
-- Una solicitud pide materiales para una orden; la bodega los despacha (todo o por partes) y lo despachado se carga a la orden
-- como una línea de material con el precio de venta del momento y el costo congelado. Una devolución baja esa línea.

CREATE TABLE solicitudes_material (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT 'SOL-000001',
  orden_id INT UNSIGNED NOT NULL,
  solicitante_id INT UNSIGNED NULL COMMENT 'usuario que la pidió',
  estado ENUM('no_despachada','despachada_parcial','despachada','anulada') NOT NULL DEFAULT 'no_despachada',
  notas VARCHAR(300) NULL,
  solicitada_en DATETIME NOT NULL,
  primer_despacho_en DATETIME NULL COMMENT 'para medir el tiempo de despacho de bodega',
  despachada_en DATETIME NULL COMMENT 'cuando quedó completa',
  anulada_en DATETIME NULL,
  anulada_por_id INT UNSIGNED NULL,
  motivo_anulacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_solicitudes_numero (numero),
  KEY ix_solicitudes_orden (orden_id),
  KEY ix_solicitudes_estado (estado, solicitada_en),
  CONSTRAINT fk_solicitudes_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_solicitudes_solicitante FOREIGN KEY (solicitante_id) REFERENCES usuarios (id),
  CONSTRAINT fk_solicitudes_anulada_por FOREIGN KEY (anulada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE solicitud_lineas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solicitud_id INT UNSIGNED NOT NULL,
  material_id INT UNSIGNED NOT NULL,
  cantidad_solicitada INT UNSIGNED NOT NULL,
  cantidad_despachada INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'acumulado bruto; lo devuelto se cuenta aparte',
  PRIMARY KEY (id),
  UNIQUE KEY uq_solicitud_lineas_material (solicitud_id, material_id),
  CONSTRAINT fk_solicitud_lineas_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes_material (id),
  CONSTRAINT fk_solicitud_lineas_material FOREIGN KEY (material_id) REFERENCES materiales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE despachos_material (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solicitud_linea_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL,
  costo_unitario DECIMAL(12,2) NOT NULL COMMENT 'costo promedio del material en el momento: queda congelado',
  movimiento_id BIGINT UNSIGNED NOT NULL,
  despachado_por_id INT UNSIGNED NULL,
  fecha DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_despachos_linea (solicitud_linea_id),
  CONSTRAINT fk_despachos_linea FOREIGN KEY (solicitud_linea_id) REFERENCES solicitud_lineas (id),
  CONSTRAINT fk_despachos_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_despachos_movimiento FOREIGN KEY (movimiento_id) REFERENCES movimientos_inventario (id),
  CONSTRAINT fk_despachos_usuario FOREIGN KEY (despachado_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE devoluciones_material (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT 'DEV-000001',
  solicitud_linea_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL,
  costo_unitario DECIMAL(12,2) NOT NULL COMMENT 'costo con el que salió; vuelve al mismo valor',
  motivo VARCHAR(200) NOT NULL,
  movimiento_id BIGINT UNSIGNED NOT NULL,
  registrada_por_id INT UNSIGNED NULL,
  fecha DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devoluciones_numero (numero),
  KEY ix_devoluciones_linea (solicitud_linea_id),
  CONSTRAINT fk_devoluciones_linea FOREIGN KEY (solicitud_linea_id) REFERENCES solicitud_lineas (id),
  CONSTRAINT fk_devoluciones_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_devoluciones_movimiento FOREIGN KEY (movimiento_id) REFERENCES movimientos_inventario (id),
  CONSTRAINT fk_devoluciones_usuario FOREIGN KEY (registrada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La línea de material de la orden ahora apunta a su material y a la línea de la solicitud que la origina (una por línea de solicitud).
ALTER TABLE lineas_orden
  ADD COLUMN solicitud_linea_id INT UNSIGNED NULL AFTER material_id,
  ADD UNIQUE KEY uq_lineas_solicitud_linea (solicitud_linea_id),
  ADD CONSTRAINT fk_lineas_material FOREIGN KEY (material_id) REFERENCES materiales (id),
  ADD CONSTRAINT fk_lineas_solicitud_linea FOREIGN KEY (solicitud_linea_id) REFERENCES solicitud_lineas (id);

-- ── Permisos ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('solicitudes.ver',       'inventario', 'VER SOLICITUDES DE MATERIAL'),
  ('solicitudes.crear',     'inventario', 'PEDIR MATERIALES PARA UNA ORDEN'),
  ('solicitudes.despachar', 'inventario', 'DESPACHAR MATERIAL A UNA ORDEN Y RECIBIR DEVOLUCIONES'),
  ('solicitudes.anular',    'inventario', 'ANULAR SOLICITUDES DE MATERIAL DE OTRAS PERSONAS');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'solicitudes.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'bodeguero' AND p.codigo IN ('solicitudes.ver', 'solicitudes.despachar', 'solicitudes.anular');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('supervisor', 'tecnico') AND p.codigo IN ('solicitudes.ver', 'solicitudes.crear');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'solicitudes.ver' FROM roles r WHERE r.codigo IN ('recepcionista', 'operador', 'visualizador');
