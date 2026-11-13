-- Fase 7c: vistas guardadas de los reportes y envíos programados por correo.

-- Una vista es una forma de mirar un reporte (periodo relativo, sucursal, tipo de equipo) con un nombre; es de cada persona.
CREATE TABLE vistas_guardadas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  reporte VARCHAR(40) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  filtros TEXT NOT NULL COMMENT 'JSON: periodo relativo, sucursal, tipo de equipo',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vistas_guardadas (usuario_id, reporte, nombre),
  CONSTRAINT fk_vistas_guardadas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un envío programado manda un reporte por correo (en el cuerpo del mensaje) con la frecuencia elegida, a partir de las 7:00 del taller.
CREATE TABLE reportes_programados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  reporte VARCHAR(40) NOT NULL,
  filtros TEXT NOT NULL,
  frecuencia ENUM('diaria','semanal','mensual') NOT NULL,
  dia_semana TINYINT UNSIGNED NULL COMMENT '1 = lunes ... 7 = domingo (semanal)',
  dia_mes TINYINT UNSIGNED NULL COMMENT '1 a 28 (mensual)',
  con_dinero TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'quien lo programó podía ver dinero',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por_id INT UNSIGNED NOT NULL,
  ultimo_envio_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_reportes_programados_usuario FOREIGN KEY (creado_por_id) REFERENCES usuarios (id),
  CONSTRAINT ck_reportes_programados_dia CHECK ((frecuencia = 'semanal' AND dia_semana BETWEEN 1 AND 7 AND dia_mes IS NULL) OR (frecuencia = 'mensual' AND dia_mes BETWEEN 1 AND 28 AND dia_semana IS NULL) OR (frecuencia = 'diaria' AND dia_semana IS NULL AND dia_mes IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reportes_programados_destinatarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporte_programado_id INT UNSIGNED NOT NULL,
  rol_id INT UNSIGNED NULL,
  usuario_id INT UNSIGNED NULL,
  correo VARCHAR(150) NULL,
  PRIMARY KEY (id),
  KEY ix_reportes_programados_destinatarios (reporte_programado_id),
  CONSTRAINT fk_rpd_programado FOREIGN KEY (reporte_programado_id) REFERENCES reportes_programados (id) ON DELETE CASCADE,
  CONSTRAINT fk_rpd_rol FOREIGN KEY (rol_id) REFERENCES roles (id),
  CONSTRAINT fk_rpd_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT ck_rpd_uno CHECK ((rol_id IS NOT NULL) + (usuario_id IS NOT NULL) + (correo IS NOT NULL) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('reportes.programar', 'reportes', 'PROGRAMAR EL ENVIO DE REPORTES POR CORREO');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'reportes.programar' FROM roles r WHERE r.codigo IN ('administrador', 'gerente');
