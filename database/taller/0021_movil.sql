-- Fase 8a: servidor de la app móvil 2.000. Sesiones largas con refresco, dispositivos, cambios con identificador (nunca se duplican al reenviarse),
-- preferencias de avisos y cola de avisos al teléfono.

-- Un teléfono (una instalación de la app) de una persona. El token de avisos solo sirve para mandarle avisos a ese teléfono.
CREATE TABLE dispositivos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  instalacion VARCHAR(64) NOT NULL COMMENT 'identificador que la app crea al instalarse',
  plataforma ENUM('android','ios') NOT NULL,
  nombre VARCHAR(100) NULL,
  version_app VARCHAR(20) NULL,
  token_push VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_uso DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispositivos_instalacion (usuario_id, instalacion),
  CONSTRAINT fk_dispositivos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La sesión de la app vale mientras se use: un token corto (8 horas) y un refresco largo que se cambia en cada uso (si alguien reusa uno viejo, la sesión se cierra).
ALTER TABLE sesiones
  ADD COLUMN movil TINYINT(1) NOT NULL DEFAULT 0 AFTER es_soporte,
  ADD COLUMN dispositivo_id INT UNSIGNED NULL AFTER movil,
  ADD COLUMN refresco_huella CHAR(64) NULL AFTER dispositivo_id,
  ADD COLUMN refresco_anterior_huella CHAR(64) NULL AFTER refresco_huella,
  ADD COLUMN refresco_vence_en DATETIME NULL AFTER refresco_anterior_huella,
  ADD COLUMN refrescada_en DATETIME NULL AFTER refresco_vence_en,
  ADD UNIQUE KEY uq_sesiones_refresco (refresco_huella),
  ADD CONSTRAINT fk_sesiones_dispositivo FOREIGN KEY (dispositivo_id) REFERENCES dispositivos (id) ON DELETE SET NULL;

-- Cada cambio que hace el teléfono lleva un identificador que crea el propio teléfono: enviarlo dos veces (por una señal mala) nunca lo duplica,
-- y quien lo envía de nuevo recibe la misma respuesta que la primera vez.
CREATE TABLE mutaciones_procesadas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  id_cliente VARCHAR(64) NOT NULL,
  metodo VARCHAR(8) NOT NULL,
  ruta VARCHAR(200) NOT NULL,
  estado ENUM('en_proceso','terminada') NOT NULL DEFAULT 'en_proceso',
  codigo_http SMALLINT UNSIGNED NULL,
  respuesta MEDIUMTEXT NULL,
  hecho_en DATETIME NULL COMMENT 'cuándo lo hizo la persona en su teléfono (UTC); sirve para ver conflictos',
  procesada_en DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mutaciones_cliente (usuario_id, id_cliente),
  KEY ix_mutaciones_fecha (procesada_en),
  CONSTRAINT fk_mutaciones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Qué avisos quiere recibir cada persona y por dónde. Sin fila, rige lo normal (los avisos al teléfono están encendidos).
CREATE TABLE preferencias_aviso (
  usuario_id INT UNSIGNED NOT NULL,
  tipo_aviso VARCHAR(40) NOT NULL,
  canal ENUM('push','correo') NOT NULL,
  activo TINYINT(1) NOT NULL,
  PRIMARY KEY (usuario_id, tipo_aviso, canal),
  CONSTRAINT fk_preferencias_aviso_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Avisos al teléfono por mandar. La clave evita avisar dos veces lo mismo a la misma persona.
CREATE TABLE notificaciones_push (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  titulo VARCHAR(100) NOT NULL,
  cuerpo VARCHAR(300) NOT NULL,
  datos TEXT NULL COMMENT 'JSON con a dónde lleva el aviso',
  clave VARCHAR(100) NOT NULL,
  estado ENUM('pendiente','enviada','sin_dispositivo','error') NOT NULL DEFAULT 'pendiente',
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_error VARCHAR(300) NULL,
  creada_en DATETIME NOT NULL,
  enviar_despues_de DATETIME NOT NULL,
  enviada_en DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notificaciones_clave (usuario_id, clave),
  KEY ix_notificaciones_cola (estado, enviar_despues_de),
  CONSTRAINT fk_notificaciones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
