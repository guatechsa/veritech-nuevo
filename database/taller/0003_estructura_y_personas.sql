-- Taller, migración 0003: estructura y personas (Fase 3b): bodegas, puestos, credenciales, jornada y ausencias.

CREATE TABLE bodegas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bodegas_sucursal_nombre (sucursal_id, nombre),
  CONSTRAINT fk_bodegas_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El puesto lleva banderas claras y separadas: quién es técnico y quién maneja equipos (decisión del módulo 7).
CREATE TABLE puestos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  es_tecnico TINYINT(1) NOT NULL DEFAULT 0,
  es_operador TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_puestos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO puestos (nombre, es_tecnico, es_operador) VALUES
  ('ADMINISTRADOR', 0, 0), ('GERENTE', 0, 0), ('SUPERVISOR', 0, 0), ('RECEPCIONISTA', 0, 0),
  ('TECNICO', 1, 0), ('OPERADOR', 0, 1), ('BODEGUERO', 0, 0);

CREATE TABLE colaborador_puestos (
  colaborador_id INT UNSIGNED NOT NULL,
  puesto_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (colaborador_id, puesto_id),
  CONSTRAINT fk_colaborador_puestos_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id),
  CONSTRAINT fk_colaborador_puestos_puesto FOREIGN KEY (puesto_id) REFERENCES puestos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Credenciales (licencia de conducir, certificado interno de operador de montacargas…): las define cada empresa.
CREATE TABLE tipos_credencial (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  requiere_vencimiento TINYINT(1) NOT NULL DEFAULT 0,
  dias_aviso SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_credencial_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE puesto_credenciales (
  puesto_id INT UNSIGNED NOT NULL,
  tipo_credencial_id INT UNSIGNED NOT NULL,
  obligatoria TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (puesto_id, tipo_credencial_id),
  CONSTRAINT fk_puesto_credenciales_puesto FOREIGN KEY (puesto_id) REFERENCES puestos (id),
  CONSTRAINT fk_puesto_credenciales_tipo FOREIGN KEY (tipo_credencial_id) REFERENCES tipos_credencial (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE colaborador_credenciales (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  colaborador_id INT UNSIGNED NOT NULL,
  tipo_credencial_id INT UNSIGNED NOT NULL,
  numero VARCHAR(60) NULL,
  vence DATE NULL,
  archivo_id INT UNSIGNED NULL COMMENT 'se enlaza con la tabla archivos cuando exista (Fase 3d)',
  notas VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_colaborador_credenciales_colaborador (colaborador_id),
  KEY ix_colaborador_credenciales_vence (vence),
  CONSTRAINT fk_colaborador_credenciales_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id),
  CONSTRAINT fk_colaborador_credenciales_tipo FOREIGN KEY (tipo_credencial_id) REFERENCES tipos_credencial (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jornada: la fija la empresa (colaborador_id NULL = general); una persona puede tener la suya, que manda sobre la general.
-- dia_semana: 1 = lunes … 7 = domingo. Un día sin fila es día de descanso.
CREATE TABLE jornadas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  colaborador_id INT UNSIGNED NULL,
  dia_semana TINYINT UNSIGNED NOT NULL,
  desde TIME NOT NULL,
  hasta TIME NOT NULL,
  pausa_desde TIME NULL,
  pausa_hasta TIME NULL,
  clave_colaborador INT UNSIGNED GENERATED ALWAYS AS (IFNULL(colaborador_id, 0)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jornadas_dia (clave_colaborador, dia_semana),
  CONSTRAINT fk_jornadas_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jornada de partida (la que tenía el sistema anterior): lunes a sábado, 07:00-16:00 con almuerzo de 12:00 a 13:00.
INSERT INTO jornadas (colaborador_id, dia_semana, desde, hasta, pausa_desde, pausa_hasta) VALUES
  (NULL, 1, '07:00', '16:00', '12:00', '13:00'), (NULL, 2, '07:00', '16:00', '12:00', '13:00'), (NULL, 3, '07:00', '16:00', '12:00', '13:00'),
  (NULL, 4, '07:00', '16:00', '12:00', '13:00'), (NULL, 5, '07:00', '16:00', '12:00', '13:00'), (NULL, 6, '07:00', '12:00', NULL, NULL);

-- Ausencias: vacaciones, permisos e incapacidades. Alimentan la capacidad del taller y la asignación de trabajo.
CREATE TABLE ausencias (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  colaborador_id INT UNSIGNED NOT NULL,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  tipo ENUM('vacaciones','permiso','incapacidad','otro') NOT NULL,
  notas VARCHAR(300) NULL,
  creada_por INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ausencias_colaborador (colaborador_id, desde, hasta),
  CONSTRAINT fk_ausencias_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
