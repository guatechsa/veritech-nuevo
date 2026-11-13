-- Fase 6b: enlaces públicos. Un enlace da acceso, SIN iniciar sesión, a UN documento (hoy: una cotización) para que el cliente lo vea y
-- autorice o rechace cada línea. Solo se guarda la huella (SHA-256) del enlace: el enlace completo se muestra una vez, al crearlo.

CREATE TABLE enlaces_publicos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  huella CHAR(64) NOT NULL COMMENT 'SHA-256 del enlace; el enlace en sí no se guarda',
  tipo ENUM('checklist','cuenta','cotizacion','cita') NOT NULL,
  entidad_id INT UNSIGNED NOT NULL,
  creado_por_id INT UNSIGNED NULL,
  vence_en DATETIME NOT NULL,
  revocado_en DATETIME NULL,
  revocado_por_id INT UNSIGNED NULL,
  primera_apertura_en DATETIME NULL COMMENT 'primera apertura REAL: no cuentan las vistas previas automáticas (WhatsApp, correo)',
  primera_apertura_ip VARCHAR(64) NULL,
  ultima_apertura_en DATETIME NULL,
  aperturas INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enlaces_huella (huella),
  KEY ix_enlaces_entidad (tipo, entidad_id),
  CONSTRAINT fk_enlaces_creado_por FOREIGN KEY (creado_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_enlaces_revocado_por FOREIGN KEY (revocado_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cotizacion_lineas
  ADD COLUMN respondida_por_nombre VARCHAR(100) NULL COMMENT 'quien respondió por el enlace (lo escribe el cliente)' AFTER respondida_por_usuario_id,
  ADD COLUMN enlace_id INT UNSIGNED NULL COMMENT 'el enlace por el que respondió' AFTER ip,
  ADD CONSTRAINT fk_cotizacion_lineas_enlace FOREIGN KEY (enlace_id) REFERENCES enlaces_publicos (id);
