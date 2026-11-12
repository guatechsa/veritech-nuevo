-- Taller, migración 0010: servicios programados (Fase 4e).
-- Cada servicio tiene su PROPIO reloj sobre un contador del equipo (kilómetros, horas o días). Un servicio solo cuenta como
-- realizado con su checklist completado; la carga de histórico y la excepción quedan registradas con quién y por qué.

CREATE TABLE servicios_programados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  trabajo_id INT UNSIGNED NOT NULL,
  checklist_tipo_id INT UNSIGNED NULL COMMENT 'al completarlo se registra el servicio como realizado',
  nombre VARCHAR(120) NOT NULL,
  tipo ENUM('mantenimiento','revision_operativa') NOT NULL DEFAULT 'mantenimiento',
  tipo_contador_id INT UNSIGNED NOT NULL,
  intervalo DECIMAL(12,2) NOT NULL,
  aviso_proximo DECIMAL(12,2) NOT NULL COMMENT 'faltando esto (en la unidad del contador) el servicio está «próximo»',
  aviso_urgente DECIMAL(12,2) NOT NULL COMMENT 'faltando esto el servicio está «urgente»',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_servicios_programados_nombre (tipo_equipo_id, nombre),
  KEY ix_servicios_programados_tipo (tipo_equipo_id, activo),
  CONSTRAINT fk_servicios_programados_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id),
  CONSTRAINT fk_servicios_programados_trabajo FOREIGN KEY (trabajo_id) REFERENCES trabajos (id),
  CONSTRAINT fk_servicios_programados_checklist FOREIGN KEY (checklist_tipo_id) REFERENCES checklist_tipos (id),
  CONSTRAINT fk_servicios_programados_contador FOREIGN KEY (tipo_contador_id) REFERENCES tipos_contador (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada vez que se hizo un servicio. Una carga equivocada se ANULA con motivo, nunca se borra.
CREATE TABLE servicios_realizados (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  equipo_id INT UNSIGNED NOT NULL,
  servicio_id INT UNSIGNED NOT NULL,
  contador_valor DECIMAL(12,2) NOT NULL COMMENT 'lo que marcaba el contador (en días desde que empezó, si es de calendario)',
  fecha DATE NOT NULL,
  orden_id INT UNSIGNED NULL,
  checklist_id INT UNSIGNED NULL,
  origen ENUM('checklist','cierre_orden','historico','excepcion') NOT NULL,
  motivo VARCHAR(300) NULL,
  registrado_por_id INT UNSIGNED NULL,
  anulado_en DATETIME NULL,
  anulado_por_id INT UNSIGNED NULL,
  motivo_anulacion VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_servicios_realizados (equipo_id, servicio_id, anulado_en),
  CONSTRAINT fk_servicios_realizados_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_servicios_realizados_servicio FOREIGN KEY (servicio_id) REFERENCES servicios_programados (id),
  CONSTRAINT fk_servicios_realizados_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_servicios_realizados_checklist FOREIGN KEY (checklist_id) REFERENCES checklists (id),
  CONSTRAINT fk_servicios_realizados_usuario FOREIGN KEY (registrado_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_servicios_realizados_anulado FOREIGN KEY (anulado_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Para no repetir un aviso: en qué estado se avisó por última vez cada servicio de cada equipo.
CREATE TABLE avisos_servicio (
  equipo_id INT UNSIGNED NOT NULL,
  servicio_id INT UNSIGNED NOT NULL,
  estado_alertado ENUM('proximo','urgente','vencido') NOT NULL,
  enviado_en DATETIME NOT NULL,
  PRIMARY KEY (equipo_id, servicio_id),
  CONSTRAINT fk_avisos_servicio_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_avisos_servicio_servicio FOREIGN KEY (servicio_id) REFERENCES servicios_programados (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La cita puede nacer de un servicio por vencer.
ALTER TABLE citas ADD CONSTRAINT fk_citas_servicio FOREIGN KEY (servicio_programado_id) REFERENCES servicios_programados (id);

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('servicios.ver',        'ordenes', 'VER SERVICIOS PROGRAMADOS Y SU ESTADO'),
  ('servicios.gestionar',  'ordenes', 'CREAR Y EDITAR LOS SERVICIOS PROGRAMADOS DE CADA TIPO DE EQUIPO'),
  ('servicios.registrar',  'ordenes', 'CARGAR SERVICIOS ANTERIORES, REGISTRAR EXCEPCIONES Y ANULAR CARGAS');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'servicios.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'supervisor' AND p.codigo IN ('servicios.ver', 'servicios.registrar');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'servicios.ver' FROM roles r WHERE r.codigo IN ('recepcionista', 'tecnico', 'operador', 'visualizador');
