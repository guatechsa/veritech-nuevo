-- Taller, migración 0006: órdenes de trabajo y sus líneas (Fase 4a).
-- Citas, checklists, servicios programados y los tiempos reales de cada técnico llegan en las partes siguientes de la Fase 4.

-- Cuando la orden llega a un estado con esta bandera, el equipo sale físicamente del taller (se cierra su ingreso).
ALTER TABLE estados_orden ADD COLUMN sale_equipo TINYINT(1) NOT NULL DEFAULT 0 AFTER es_cancelado;
UPDATE estados_orden SET sale_equipo = 1 WHERE codigo IN ('ENTREGADA', 'CERRADA', 'ANULADA');

-- Tarifa de venta y costo por hora de un tipo de equipo cuando se trabaja en un área concreta (si no hay fila, rige la del tipo de equipo).
CREATE TABLE tarifas_area (
  area_trabajo_id INT UNSIGNED NOT NULL,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  tarifa_venta_hora DECIMAL(10,2) NOT NULL DEFAULT 0,
  costo_hora DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'lo que le cuesta al taller: interno, nunca se muestra al cliente',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (area_trabajo_id, tipo_equipo_id),
  CONSTRAINT fk_tarifas_area_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id),
  CONSTRAINT fk_tarifas_area_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La orden. Una orden se anula con motivo, nunca se borra. El cliente sale del equipo (nulo si el equipo es del propio taller).
CREATE TABLE ordenes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL COMMENT '<código del tipo de orden>-000001, con bloqueo (tabla secuencias)',
  cliente_id INT UNSIGNED NULL,
  equipo_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  area_trabajo_id INT UNSIGNED NULL COMMENT 'área principal',
  tipo_orden_id INT UNSIGNED NOT NULL,
  estado_id INT UNSIGNED NOT NULL,
  prioridad ENUM('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
  origen ENUM('directo','cita') NOT NULL DEFAULT 'directo',
  cita_id INT UNSIGNED NULL COMMENT 'la cita se agrega en la parte 4c',
  descripcion VARCHAR(500) NULL COMMENT 'lo que se pide o se reporta del equipo',
  referencia_factura_externa VARCHAR(40) NULL COMMENT 'número del sistema de caja del taller; este sistema no factura',
  responsable_id INT UNSIGNED NULL COMMENT 'colaborador a cargo de la orden',
  creada_por_id INT UNSIGNED NULL,
  fecha_estimada_entrega DATE NULL,
  fecha_cierre DATETIME NULL,
  motivo_anulacion_id INT UNSIGNED NULL,
  motivo_anulacion_texto VARCHAR(300) NULL,
  notificar_nombre VARCHAR(120) NULL,
  notificar_correo VARCHAR(150) NULL,
  notificar_telefono VARCHAR(40) NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ordenes_numero (numero),
  KEY ix_ordenes_estado (estado_id),
  KEY ix_ordenes_cliente (cliente_id),
  KEY ix_ordenes_equipo (equipo_id),
  KEY ix_ordenes_responsable (responsable_id),
  KEY ix_ordenes_creada (created_at),
  CONSTRAINT fk_ordenes_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_ordenes_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_ordenes_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id),
  CONSTRAINT fk_ordenes_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id),
  CONSTRAINT fk_ordenes_tipo FOREIGN KEY (tipo_orden_id) REFERENCES tipos_orden (id),
  CONSTRAINT fk_ordenes_estado FOREIGN KEY (estado_id) REFERENCES estados_orden (id),
  CONSTRAINT fk_ordenes_responsable FOREIGN KEY (responsable_id) REFERENCES colaboradores (id),
  CONSTRAINT fk_ordenes_creada_por FOREIGN KEY (creada_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_ordenes_motivo FOREIGN KEY (motivo_anulacion_id) REFERENCES motivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada cambio de estado, con quién y cuándo: de aquí salen los días en taller y los tiempos de despacho.
CREATE TABLE orden_estados_historial (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  orden_id INT UNSIGNED NOT NULL,
  estado_id INT UNSIGNED NOT NULL,
  desde DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT UNSIGNED NULL,
  motivo VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY ix_orden_estados_historial (orden_id, id),
  CONSTRAINT fk_orden_estados_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_orden_estados_estado FOREIGN KEY (estado_id) REFERENCES estados_orden (id),
  CONSTRAINT fk_orden_estados_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Presencia física del equipo en el taller: «en taller» no se guarda en el equipo, se calcula de aquí (salida_en vacía).
CREATE TABLE ingresos_equipo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  orden_id INT UNSIGNED NOT NULL,
  equipo_id INT UNSIGNED NOT NULL,
  entrada_en DATETIME NOT NULL,
  salida_en DATETIME NULL,
  recibido_por_id INT UNSIGNED NULL,
  lectura_contador_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ingresos_equipo (equipo_id, salida_en),
  KEY ix_ingresos_orden (orden_id),
  CONSTRAINT fk_ingresos_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_ingresos_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_ingresos_usuario FOREIGN KEY (recibido_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_ingresos_lectura FOREIGN KEY (lectura_contador_id) REFERENCES lecturas_contador (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Líneas de la orden: servicios (el precio es horas × tarifa por hora), materiales (llegan con Inventario) y trabajos con terceros.
-- Se guarda una COPIA de la tarifa y del costo del momento: el precio ya fijado no cambia si luego cambian las tarifas.
CREATE TABLE lineas_orden (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  orden_id INT UNSIGNED NOT NULL,
  tipo ENUM('servicio','material','tercero') NOT NULL,
  trabajo_id INT UNSIGNED NULL,
  material_id INT UNSIGNED NULL COMMENT 'la tabla de materiales llega en la Fase 5',
  proveedor_id INT UNSIGNED NULL,
  descripcion VARCHAR(250) NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  total_linea DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'lo que le cuesta al taller: interno, nunca se muestra al cliente',
  horas_trabajo DECIMAL(6,2) NULL,
  tarifa_hora_aplicada DECIMAL(10,2) NULL,
  costo_hora_aplicado DECIMAL(10,2) NULL,
  area_trabajo_id INT UNSIGNED NULL,
  tecnico_id INT UNSIGNED NULL,
  estado ENUM('pendiente','en_proceso','pausado','detenido_material','detenido_terceros','detenido_autorizacion','detenido_espacio','terminado') NOT NULL DEFAULT 'pendiente',
  inicio_en DATETIME NULL,
  pausa_en DATETIME NULL,
  fin_en DATETIME NULL,
  notas VARCHAR(500) NULL,
  anulada_en DATETIME NULL,
  anulada_por_id INT UNSIGNED NULL,
  motivo_anulacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_lineas_orden (orden_id, id),
  KEY ix_lineas_tecnico (tecnico_id, estado),
  CONSTRAINT fk_lineas_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_lineas_trabajo FOREIGN KEY (trabajo_id) REFERENCES trabajos (id),
  CONSTRAINT fk_lineas_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  CONSTRAINT fk_lineas_area FOREIGN KEY (area_trabajo_id) REFERENCES areas_trabajo (id),
  CONSTRAINT fk_lineas_tecnico FOREIGN KEY (tecnico_id) REFERENCES colaboradores (id),
  CONSTRAINT fk_lineas_anulada_por FOREIGN KEY (anulada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permisos de las órdenes ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('ordenes.ver',            'ordenes', 'VER ORDENES DE TRABAJO'),
  ('ordenes.crear',          'ordenes', 'CREAR ORDENES DE TRABAJO'),
  ('ordenes.editar',         'ordenes', 'EDITAR ORDENES Y SUS LINEAS'),
  ('ordenes.cambiar_estado', 'ordenes', 'CAMBIAR EL ESTADO DE UNA ORDEN'),
  ('ordenes.anular',         'ordenes', 'ANULAR ORDENES CON MOTIVO'),
  ('ordenes.reabrir',        'ordenes', 'REABRIR UNA ORDEN CERRADA'),
  ('ordenes.ver_precios',    'ordenes', 'VER PRECIOS, DESCUENTOS Y TOTALES DE LAS ORDENES'),
  ('ordenes.ver_costos',     'ordenes', 'VER LO QUE LE CUESTA AL TALLER CADA LINEA (INTERNO)'),
  ('tarifas.gestionar',      'ordenes', 'CAMBIAR TARIFAS POR AREA Y TIPO DE EQUIPO');

-- Administrador y gerente: todo lo nuevo.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo IN ('administrador', 'gerente') AND p.modulo = 'ordenes' AND p.codigo IN
   ('ordenes.ver', 'ordenes.crear', 'ordenes.editar', 'ordenes.cambiar_estado', 'ordenes.anular', 'ordenes.reabrir', 'ordenes.ver_precios', 'ordenes.ver_costos', 'tarifas.gestionar');

-- Supervisor: coordina y ve precios, pero no reabre ni ve costos internos.
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'supervisor' AND p.codigo IN ('ordenes.ver', 'ordenes.crear', 'ordenes.editar', 'ordenes.cambiar_estado', 'ordenes.anular', 'ordenes.ver_precios');

-- Recepcionista: recibe equipos y atiende al cliente (ve precios).
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo = 'recepcionista' AND p.codigo IN ('ordenes.ver', 'ordenes.crear', 'ordenes.editar', 'ordenes.cambiar_estado', 'ordenes.ver_precios');

-- Técnico, operador, bodeguero y visualizador: solo consultan (sin precios).
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'ordenes.ver' FROM roles r WHERE r.codigo IN ('tecnico', 'operador', 'bodeguero', 'visualizador');
