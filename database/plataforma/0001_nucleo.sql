-- Plataforma, migración 0001: núcleo (planes, módulos, empresas, usuarios de plataforma, tokens, auditoría y correos).
-- Todas las horas de negocio van en UTC (DATETIME); created_at/updated_at son TIMESTAMP y las conexiones trabajan en UTC.

CREATE TABLE planes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  precio_mensual DECIMAL(10,2) NOT NULL,
  max_usuarios INT UNSIGNED NULL COMMENT 'NULL = sin límite',
  max_sucursales INT UNSIGNED NULL COMMENT 'NULL = sin límite',
  paypal_plan_prueba VARCHAR(60) NULL,
  paypal_plan_regular VARCHAR(60) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_planes_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE modulos (
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE plan_modulos (
  plan_id INT UNSIGNED NOT NULL,
  modulo_codigo VARCHAR(40) NOT NULL,
  PRIMARY KEY (plan_id, modulo_codigo),
  CONSTRAINT fk_plan_modulos_plan FOREIGN KEY (plan_id) REFERENCES planes (id),
  CONSTRAINT fk_plan_modulos_modulo FOREIGN KEY (modulo_codigo) REFERENCES modulos (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE empresas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  nombre_bd VARCHAR(64) NOT NULL,
  subdominio VARCHAR(120) NOT NULL,
  estado ENUM('pendiente','prueba','activa','pago_fallido','suspendida','cancelada_con_acceso','solo_exportar','cerrada') NOT NULL DEFAULT 'pendiente',
  plan_id INT UNSIGNED NULL,
  cuota_mensual DECIMAL(10,2) NULL COMMENT 'NULL = sin cuota registrada (el panel muestra —)',
  cobro_por_contrato TINYINT(1) NOT NULL DEFAULT 0,
  es_demo TINYINT(1) NOT NULL DEFAULT 0,
  paypal_suscripcion_id VARCHAR(60) NULL,
  prueba_hasta DATETIME NULL,
  gracia_hasta DATETIME NULL,
  acceso_hasta DATETIME NULL,
  cancelacion_solicitada_en DATETIME NULL,
  exportable_hasta DATETIME NULL,
  borrado_programado_en DATETIME NULL,
  contacto_nombre VARCHAR(120) NULL,
  contacto_correo VARCHAR(150) NULL,
  version_legal_aceptada VARCHAR(10) NULL,
  legal_aceptada_en DATETIME NULL,
  legal_aceptada_ip VARCHAR(45) NULL,
  zona_horaria VARCHAR(40) NOT NULL DEFAULT 'America/Guatemala',
  provisionada_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_empresas_slug (slug),
  UNIQUE KEY uq_empresas_nombre_bd (nombre_bd),
  UNIQUE KEY uq_empresas_subdominio (subdominio),
  UNIQUE KEY uq_empresas_paypal (paypal_suscripcion_id),
  KEY ix_empresas_estado (estado),
  CONSTRAINT fk_empresas_plan FOREIGN KEY (plan_id) REFERENCES planes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE empresa_modulos (
  empresa_id INT UNSIGNED NOT NULL,
  modulo_codigo VARCHAR(40) NOT NULL,
  PRIMARY KEY (empresa_id, modulo_codigo),
  CONSTRAINT fk_empresa_modulos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_empresa_modulos_modulo FOREIGN KEY (modulo_codigo) REFERENCES modulos (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE usuarios_plataforma (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(150) NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL,
  rol ENUM('SUPER_ADMIN','ADMIN','VIEWER') NOT NULL DEFAULT 'VIEWER',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_ingreso DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_plataforma_correo (correo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tokens_recuperacion (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_plataforma_id INT UNSIGNED NOT NULL,
  huella CHAR(64) NOT NULL,
  vence_en DATETIME NOT NULL,
  usado_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_recuperacion_huella (huella),
  KEY ix_tokens_recuperacion_usuario (usuario_plataforma_id),
  CONSTRAINT fk_tokens_recuperacion_usuario FOREIGN KEY (usuario_plataforma_id) REFERENCES usuarios_plataforma (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tokens_acceso_soporte (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  huella CHAR(64) NOT NULL,
  empresa_id INT UNSIGNED NOT NULL,
  usuario_destino_id INT UNSIGNED NOT NULL COMMENT 'id del usuario DENTRO de la base del taller',
  creado_por INT UNSIGNED NOT NULL,
  vence_en DATETIME NOT NULL,
  usado_en DATETIME NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_acceso_soporte_huella (huella),
  CONSTRAINT fk_tokens_acceso_soporte_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_tokens_acceso_soporte_creador FOREIGN KEY (creado_por) REFERENCES usuarios_plataforma (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auditoria_plataforma (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_plataforma_id INT UNSIGNED NULL,
  accion VARCHAR(60) NOT NULL,
  empresa_id INT UNSIGNED NULL,
  descripcion VARCHAR(500) NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_auditoria_plataforma_fecha (created_at),
  KEY ix_auditoria_plataforma_usuario (usuario_plataforma_id),
  KEY ix_auditoria_plataforma_empresa (empresa_id),
  CONSTRAINT fk_auditoria_plataforma_usuario FOREIGN KEY (usuario_plataforma_id) REFERENCES usuarios_plataforma (id),
  CONSTRAINT fk_auditoria_plataforma_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE correos_salida (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo VARCHAR(40) NOT NULL,
  destinatarios VARCHAR(500) NOT NULL COMMENT 'direcciones separadas por coma',
  asunto VARCHAR(200) NOT NULL,
  cuerpo MEDIUMTEXT NOT NULL,
  estado ENUM('pendiente','enviado','error') NOT NULL DEFAULT 'pendiente',
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_error VARCHAR(500) NULL,
  enviar_despues_de DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  enviado_en DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_correos_salida_cola (estado, enviar_despues_de)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
