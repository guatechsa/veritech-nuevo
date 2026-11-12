-- Taller, migración 0008: citas (Fase 4c).
-- La cita es una reserva de espacio, aparte de la orden. Siempre se registra si el cliente SE PRESENTÓ o NO SE PRESENTÓ,
-- y la orden que nace de ella apunta a la cita (ordenes.cita_id). Todas las horas se guardan en UTC.

CREATE TABLE citas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  cliente_id INT UNSIGNED NULL COMMENT 'sale del equipo; nulo si el equipo es del propio taller',
  sucursal_id INT UNSIGNED NOT NULL,
  fecha_hora DATETIME NOT NULL COMMENT 'UTC',
  horas_estimadas DECIMAL(4,2) NOT NULL DEFAULT 1 COMMENT 'alimenta la planificación de carga',
  estado ENUM('programada','se_presento','no_se_presento','cancelada') NOT NULL DEFAULT 'programada',
  origen ENUM('recepcion','aviso','portal') NOT NULL DEFAULT 'recepcion',
  servicio_programado_id INT UNSIGNED NULL COMMENT 'la tabla de servicios programados llega en la parte 4e',
  motivo_cancelacion_id INT UNSIGNED NULL,
  motivo_cancelacion_texto VARCHAR(300) NULL,
  lectura_contador DECIMAL(12,2) NULL COMMENT 'lo que dijo el cliente al pedir la cita; la lectura oficial se toma al recibir el equipo',
  notas VARCHAR(500) NULL,
  llegada_en DATETIME NULL COMMENT 'cuándo se presentó: de aquí sale la puntualidad',
  creada_por_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_citas_fecha (fecha_hora),
  KEY ix_citas_estado (estado, fecha_hora),
  KEY ix_citas_equipo (equipo_id),
  KEY ix_citas_sucursal (sucursal_id, fecha_hora),
  CONSTRAINT fk_citas_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_citas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_citas_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id),
  CONSTRAINT fk_citas_motivo FOREIGN KEY (motivo_cancelacion_id) REFERENCES motivos (id),
  CONSTRAINT fk_citas_creada_por FOREIGN KEY (creada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una cita da, a lo más, UNA orden.
ALTER TABLE ordenes ADD CONSTRAINT fk_ordenes_cita FOREIGN KEY (cita_id) REFERENCES citas (id);
ALTER TABLE ordenes ADD UNIQUE KEY uq_ordenes_cita (cita_id);

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('citas.ver',       'ordenes', 'VER CITAS'),
  ('citas.gestionar', 'ordenes', 'CREAR, REPROGRAMAR, CANCELAR Y RECIBIR CITAS');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p
 WHERE r.codigo IN ('administrador', 'gerente', 'supervisor', 'recepcionista') AND p.codigo IN ('citas.ver', 'citas.gestionar');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'citas.ver' FROM roles r WHERE r.codigo IN ('tecnico', 'operador', 'visualizador');
