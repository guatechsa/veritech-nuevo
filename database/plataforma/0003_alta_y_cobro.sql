-- Plataforma, migración 0003: alta de talleres, cobro y ciclo de vida de la suscripción (Fase 2).

ALTER TABLE empresas
  ADD COLUMN subdominio_listo_en DATETIME NULL COMMENT 'cuando el subdominio respondió; recién entonces sale el correo de bienvenida' AFTER provisionada_en,
  ADD COLUMN proximo_cobro_en DATETIME NULL COMMENT 'último dato de PayPal' AFTER subdominio_listo_en,
  ADD COLUMN paypal_estado VARCHAR(30) NULL COMMENT 'último estado de la suscripción informado por PayPal' AFTER proximo_cobro_en,
  ADD COLUMN ultima_conciliacion_en DATETIME NULL AFTER paypal_estado,
  ADD COLUMN estado_desde DATETIME NULL COMMENT 'desde cuándo está en el estado actual (UTC)' AFTER ultima_conciliacion_en,
  ADD COLUMN suspension_origen ENUM('manual','pago') NULL COMMENT 'quién suspendió: una suspensión manual no se levanta sola' AFTER estado_desde;

-- Un correo se envía una sola vez por clave (p. ej. "prueba_7d:12"): evita duplicados cuando una tarea corre dos veces.
ALTER TABLE correos_salida
  ADD COLUMN clave_unica VARCHAR(120) NULL AFTER tipo,
  ADD UNIQUE KEY uq_correos_salida_clave (clave_unica);

CREATE TABLE pagos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id INT UNSIGNED NOT NULL,
  paypal_transaccion_id VARCHAR(40) NOT NULL,
  fecha DATETIME NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'USD',
  estado VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pagos_transaccion (paypal_transaccion_id),
  KEY ix_pagos_empresa_fecha (empresa_id, fecha),
  CONSTRAINT fk_pagos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suscripcion_eventos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id INT UNSIGNED NULL,
  evento_paypal_id VARCHAR(60) NULL COMMENT 'un aviso de PayPal nunca se registra dos veces',
  tipo VARCHAR(60) NOT NULL,
  estado_antes VARCHAR(30) NULL,
  estado_despues VARCHAR(30) NULL,
  origen ENUM('aviso','conciliacion','manual','sistema') NOT NULL,
  usuario_plataforma_id INT UNSIGNED NULL,
  detalle VARCHAR(500) NULL,
  payload MEDIUMTEXT NULL,
  procesado_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suscripcion_eventos_paypal (evento_paypal_id),
  KEY ix_suscripcion_eventos_empresa (empresa_id, id),
  CONSTRAINT fk_suscripcion_eventos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_suscripcion_eventos_usuario FOREIGN KEY (usuario_plataforma_id) REFERENCES usuarios_plataforma (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subdominios_reservados (
  slug VARCHAR(50) NOT NULL,
  PRIMARY KEY (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subdominios_reservados (slug) VALUES
  ('api'),('admin'),('www'),('mail'),('correo'),('smtp'),('imap'),('pop'),('ftp'),('webmail'),('cpanel'),('whm'),('webdisk'),
  ('cpcalendars'),('cpcontacts'),('autodiscover'),('autoconfig'),('ns1'),('ns2'),('app'),('apps'),('demo'),('pruebas'),('test'),
  ('prueba'),('staging'),('dev'),('soporte'),('support'),('ayuda'),('help'),('status'),('blog'),('docs'),('portal'),('registro'),
  ('entrar'),('login'),('hub'),('cdn'),('static'),('assets'),('veritech'),('guatech'),('root'),('administrador'),('sistema'),
  ('biltech'),('safetech'),('qualitech'),('selltech'),('paytech'),('buytech'),('fleetech'),('soportech'),('teamtech'),('axestech'),
  ('cartech'),('tagtech'),('tiretech'),('fueltech'),('nutrilud');

-- Sala de espera del registro: reemplaza el uso de `empresas` como "pendiente" del sistema anterior.
CREATE TABLE altas_pendientes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pase_hash CHAR(64) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  nombre_taller VARCHAR(150) NOT NULL,
  admin_nombre VARCHAR(120) NOT NULL,
  admin_correo VARCHAR(150) NOT NULL,
  contrasena_hash VARCHAR(255) NULL COMMENT 'se borra cuando el taller queda creado',
  plan_id INT UNSIGNED NOT NULL,
  version_legal VARCHAR(10) NOT NULL,
  ip VARCHAR(45) NULL,
  paypal_suscripcion_id VARCHAR(60) NULL,
  estado ENUM('emitida','aprobada','usada','vencida','error') NOT NULL DEFAULT 'emitida',
  empresa_id INT UNSIGNED NULL,
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  vence_en DATETIME NOT NULL,
  aprobada_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  slug_reservado VARCHAR(50) GENERATED ALWAYS AS (IF(estado IN ('emitida','aprobada','error'), slug, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_altas_pase (pase_hash),
  UNIQUE KEY uq_altas_slug_reservado (slug_reservado),
  UNIQUE KEY uq_altas_suscripcion (paypal_suscripcion_id),
  KEY ix_altas_estado (estado, vence_en),
  CONSTRAINT fk_altas_plan FOREIGN KEY (plan_id) REFERENCES planes (id),
  CONSTRAINT fk_altas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un correo, varios talleres (decisión del módulo 13): qué talleres tiene cada correo, para la página "Entrar".
CREATE TABLE directorio_acceso (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  correo VARCHAR(150) NOT NULL,
  empresa_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NOT NULL COMMENT 'id del usuario DENTRO de la base del taller',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_directorio_correo_empresa (correo, empresa_id),
  KEY ix_directorio_empresa (empresa_id),
  CONSTRAINT fk_directorio_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
