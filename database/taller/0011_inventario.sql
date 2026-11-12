-- Taller, migración 0011: inventario — materiales, existencias por bodega, compras, traslados y diferencias (Fase 5a).
-- Las solicitudes de material, el despacho a las órdenes, las devoluciones y las reservas llegan en las partes 5b y 5c.
--
-- Reglas de diseño aprobadas por Luis: las cantidades son SIEMPRE enteras (para vender «medio metro» se usa la unidad centímetros);
-- la existencia vive en UN solo lugar (existencias por bodega); toda cantidad cambia solo por un movimiento con su motivo y su usuario;
-- la ÚNICA forma de corregir una cantidad (fuera de compra, despacho, devolución y traslado) es la «diferencia de inventario».

-- Insumos generales (sistema 99 de fábrica): subsistemas y partes básicos para clasificar lo que no es de un sistema técnico.
INSERT INTO subsistemas (sistema_id, codigo, nombre) SELECT id, '01', 'LUBRICANTES Y FLUIDOS' FROM sistemas WHERE codigo = '99';
INSERT INTO subsistemas (sistema_id, codigo, nombre) SELECT id, '02', 'TORNILLERIA Y SUJECION' FROM sistemas WHERE codigo = '99';
INSERT INTO subsistemas (sistema_id, codigo, nombre) SELECT id, '03', 'LIMPIEZA Y CONSUMIBLES' FROM sistemas WHERE codigo = '99';
INSERT INTO partes (subsistema_id, codigo, nombre) SELECT x.id, '01', 'GENERAL' FROM subsistemas x JOIN sistemas s ON s.id = x.sistema_id WHERE s.codigo = '99';

CREATE TABLE materiales (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  descripcion VARCHAR(500) NULL,
  parte_id INT UNSIGNED NOT NULL COMMENT 'la clasificación es obligatoria: sistema > subsistema > parte',
  marca_id INT UNSIGNED NULL,
  codigo_oem VARCHAR(60) NULL,
  unidad_id INT UNSIGNED NOT NULL,
  existencia_minima INT UNSIGNED NOT NULL DEFAULT 0,
  ubicacion VARCHAR(60) NULL,
  costo_ultimo DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_promedio DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'ponderado por las existencias: se calcula en cada compra',
  precio_manual DECIMAL(12,2) NULL COMMENT 'vacío = el precio sale del costo más el margen',
  proveedor_principal_id INT UNSIGNED NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_materiales_codigo (codigo),
  KEY ix_materiales_nombre (nombre),
  KEY ix_materiales_parte (parte_id),
  CONSTRAINT fk_materiales_parte FOREIGN KEY (parte_id) REFERENCES partes (id),
  CONSTRAINT fk_materiales_marca FOREIGN KEY (marca_id) REFERENCES marcas (id),
  CONSTRAINT fk_materiales_unidad FOREIGN KEY (unidad_id) REFERENCES unidades (id),
  CONSTRAINT fk_materiales_proveedor FOREIGN KEY (proveedor_principal_id) REFERENCES proveedores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cuánto hay de cada material en cada bodega. UNSIGNED: la base misma impide que una cantidad quede negativa.
CREATE TABLE existencias (
  material_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (material_id, bodega_id),
  CONSTRAINT fk_existencias_material FOREIGN KEY (material_id) REFERENCES materiales (id),
  CONSTRAINT fk_existencias_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El libro de movimientos: cada cambio de cantidad, con signo, el saldo DE ESA BODEGA, el costo del momento y quién lo hizo.
CREATE TABLE movimientos_inventario (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  tipo ENUM('compra','despacho','devolucion','traslado_salida','traslado_entrada','diferencia') NOT NULL,
  cantidad INT NOT NULL COMMENT 'con signo: entra (+) o sale (−)',
  saldo_resultante INT UNSIGNED NOT NULL,
  costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  referencia_tipo VARCHAR(20) NULL,
  referencia_id INT UNSIGNED NULL,
  motivo_id INT UNSIGNED NULL,
  notas VARCHAR(300) NULL,
  usuario_id INT UNSIGNED NULL,
  fecha DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_movimientos_material (material_id, bodega_id, id),
  KEY ix_movimientos_referencia (referencia_tipo, referencia_id),
  KEY ix_movimientos_fecha (fecha),
  CONSTRAINT fk_movimientos_material FOREIGN KEY (material_id) REFERENCES materiales (id),
  CONSTRAINT fk_movimientos_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_movimientos_motivo FOREIGN KEY (motivo_id) REFERENCES motivos (id),
  CONSTRAINT fk_movimientos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Compras: UN documento por factura, con todas sus líneas, recibido en una bodega. NO se liga a órdenes de trabajo.
CREATE TABLE compras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT 'COM-000001',
  proveedor_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  fecha_documento DATE NOT NULL,
  numero_factura VARCHAR(40) NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  notas VARCHAR(300) NULL,
  creada_por_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_compras_numero (numero),
  UNIQUE KEY uq_compras_factura (proveedor_id, numero_factura),
  KEY ix_compras_fecha (fecha_documento),
  CONSTRAINT fk_compras_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  CONSTRAINT fk_compras_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_compras_usuario FOREIGN KEY (creada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE compra_lineas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  compra_id INT UNSIGNED NOT NULL,
  material_id INT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL,
  costo_unitario DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_compra_lineas (compra_id),
  CONSTRAINT fk_compra_lineas_compra FOREIGN KEY (compra_id) REFERENCES compras (id),
  CONSTRAINT fk_compra_lineas_material FOREIGN KEY (material_id) REFERENCES materiales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Margen de ganancia por clasificación; manda el más específico (material > parte > subsistema > sistema > margen general).
CREATE TABLE margenes (
  nivel ENUM('sistema','subsistema','parte','material') NOT NULL,
  referencia_id INT UNSIGNED NOT NULL,
  porcentaje DECIMAL(6,2) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (nivel, referencia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permisos del inventario ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('inventario.ver',         'inventario', 'VER MATERIALES Y EXISTENCIAS'),
  ('inventario.ver_costos',  'inventario', 'VER COSTOS Y MARGENES DE LOS MATERIALES (INTERNO)'),
  ('inventario.catalogo',    'inventario', 'CREAR Y EDITAR MATERIALES Y MARGENES'),
  ('inventario.recibir',     'inventario', 'REGISTRAR COMPRAS RECIBIDAS EN BODEGA'),
  ('inventario.trasladar',   'inventario', 'TRASLADAR MATERIAL ENTRE BODEGAS'),
  ('inventario.diferencias', 'inventario', 'REGISTRAR DIFERENCIAS DE INVENTARIO (CORREGIR UNA CANTIDAD)');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.modulo = 'inventario' AND p.codigo LIKE 'inventario.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'bodeguero' AND p.codigo IN ('inventario.ver', 'inventario.recibir', 'inventario.trasladar', 'inventario.diferencias');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'supervisor' AND p.codigo IN ('inventario.ver', 'inventario.ver_costos');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'inventario.ver' FROM roles r WHERE r.codigo IN ('recepcionista', 'tecnico', 'operador', 'visualizador');
