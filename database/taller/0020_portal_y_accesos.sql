-- Fase 7d: bitácora única de lo que ve el cliente, portal del cliente (correo + código) y citas pedidas desde el portal.

-- Cada vez que alguien abre de verdad un enlace, el QR de un equipo o el portal, queda aquí (se ve en la ficha del cliente).
CREATE TABLE accesos_cliente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canal ENUM('enlace','portal','qr') NOT NULL,
  tipo VARCHAR(30) NOT NULL COMMENT 'cotizacion, cuenta, checklist, equipo, entrada...',
  entidad_id INT UNSIGNED NULL,
  referencia VARCHAR(60) NULL COMMENT 'lo que el taller reconoce: COT-000015, CTA-000002, CAM-1 · C123ABC',
  cliente_id INT UNSIGNED NULL,
  contacto_id INT UNSIGNED NULL,
  ip VARCHAR(64) NOT NULL,
  dispositivo VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_accesos_cliente (cliente_id, id),
  CONSTRAINT fk_accesos_cliente_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_accesos_cliente_contacto FOREIGN KEY (contacto_id) REFERENCES contactos_cliente (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El código de 6 números que se manda al correo de una persona de contacto para entrar al portal. Solo se guarda su huella.
CREATE TABLE portal_codigos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  correo VARCHAR(150) NOT NULL,
  huella CHAR(64) NOT NULL COMMENT 'SHA-256 de correo + código: el código no se guarda',
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  usado_en DATETIME NULL,
  vence_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL,
  ip VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY ix_portal_codigos_correo (correo, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una sesión del portal: el taller las ve y las revoca. Solo se guarda la huella de la llave.
CREATE TABLE portal_sesiones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  huella CHAR(64) NOT NULL,
  correo VARCHAR(150) NOT NULL,
  vence_en DATETIME NOT NULL,
  revocada_en DATETIME NULL,
  revocada_por_id INT UNSIGNED NULL,
  ip VARCHAR(64) NULL,
  dispositivo VARCHAR(200) NULL,
  creada_en DATETIME NOT NULL,
  ultima_actividad_en DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_sesiones_huella (huella),
  KEY ix_portal_sesiones_correo (correo),
  CONSTRAINT fk_portal_sesiones_revocada_por FOREIGN KEY (revocada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una cita pedida desde el portal nace «por confirmar»: la recepción la confirma (o la cambia o cancela).
ALTER TABLE citas
  ADD COLUMN por_confirmar TINYINT(1) NOT NULL DEFAULT 0 AFTER origen,
  ADD COLUMN solicitada_por_contacto_id INT UNSIGNED NULL AFTER por_confirmar,
  ADD CONSTRAINT fk_citas_contacto FOREIGN KEY (solicitada_por_contacto_id) REFERENCES contactos_cliente (id);

-- Aviso a la recepción cuando un cliente pide una cita (encendido de fábrica: sin él, nadie se enteraría).
INSERT INTO avisos_config (tipo_aviso, activo, umbral_dias) VALUES ('cita_solicitada', 1, NULL);
INSERT INTO avisos_destinatarios (tipo_aviso, rol_id) SELECT 'cita_solicitada', r.id FROM roles r WHERE r.codigo = 'recepcionista';
