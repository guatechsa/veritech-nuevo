-- Fase 7b: avisos incluidos. Los tipos de aviso y sus textos incluidos viven en el código; aquí vive lo que cada taller decide:
-- si cada aviso está encendido, sus textos propios, su umbral y a quién le llega. El correo sale por la cola de la plataforma.

CREATE TABLE avisos_config (
  tipo_aviso VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 0,
  asunto VARCHAR(200) NULL COMMENT 'vacío: se usa el texto incluido',
  cuerpo TEXT NULL COMMENT 'vacío: se usa el texto incluido; admite {datos} del aviso',
  umbral_dias SMALLINT UNSIGNED NULL COMMENT 'con cuántos días de anticipación (solo en los avisos que lo usan)',
  incluir_contextual TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'también le llega a la persona del hecho (quien cotizó, el cliente...)',
  actualizado_por_id INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tipo_aviso),
  CONSTRAINT fk_avisos_config_usuario FOREIGN KEY (actualizado_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada fila es UN destinatario: un rol (le llega a todos los de ese rol), una persona o un correo suelto.
CREATE TABLE avisos_destinatarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_aviso VARCHAR(40) NOT NULL,
  rol_id INT UNSIGNED NULL,
  usuario_id INT UNSIGNED NULL,
  correo VARCHAR(150) NULL,
  PRIMARY KEY (id),
  KEY ix_avisos_destinatarios_tipo (tipo_aviso),
  CONSTRAINT fk_avisos_destinatarios_tipo FOREIGN KEY (tipo_aviso) REFERENCES avisos_config (tipo_aviso),
  CONSTRAINT fk_avisos_destinatarios_rol FOREIGN KEY (rol_id) REFERENCES roles (id),
  CONSTRAINT fk_avisos_destinatarios_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT ck_avisos_destinatarios_uno CHECK ((rol_id IS NOT NULL) + (usuario_id IS NOT NULL) + (correo IS NOT NULL) = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Constancia de lo avisado: la clave identifica el hecho (por ejemplo la cotización 15) y la restricción única evita avisar dos veces lo mismo.
CREATE TABLE avisos_registro (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_aviso VARCHAR(40) NOT NULL,
  clave VARCHAR(150) NOT NULL,
  asunto VARCHAR(200) NOT NULL,
  destinatarios SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  estado ENUM('encolado','sin_destinatarios') NOT NULL,
  referencia VARCHAR(60) NULL COMMENT 'el documento del hecho: COT-000015, SOL-000003...',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_avisos_registro (tipo_aviso, clave),
  KEY ix_avisos_registro_fecha (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO avisos_config (tipo_aviso, activo, umbral_dias) VALUES
  ('servicio_proximo', 1, NULL),
  ('servicio_vencido', 1, NULL),
  ('recordatorio_cita', 0, 1),
  ('material_pendiente_cargado', 1, NULL),
  ('solicitud_material_nueva', 1, NULL),
  ('cotizacion_respondida', 1, NULL),
  ('cotizacion_por_vencer', 0, 2),
  ('documento_por_vencer', 0, NULL),
  ('reserva_por_vencer', 0, 1),
  ('enlace_primera_apertura', 0, NULL),
  ('resumen_diario', 0, NULL),
  ('resumen_semanal', 0, NULL);

-- Destinatarios de fábrica por rol (cada taller los cambia).
INSERT INTO avisos_destinatarios (tipo_aviso, rol_id)
SELECT t.tipo, r.id FROM roles r JOIN (
  SELECT 'servicio_proximo' AS tipo, 'supervisor' AS rol UNION ALL SELECT 'servicio_proximo', 'gerente'
  UNION ALL SELECT 'servicio_vencido', 'supervisor' UNION ALL SELECT 'servicio_vencido', 'gerente'
  UNION ALL SELECT 'solicitud_material_nueva', 'bodeguero'
  UNION ALL SELECT 'cotizacion_respondida', 'recepcionista'
  UNION ALL SELECT 'documento_por_vencer', 'supervisor'
  UNION ALL SELECT 'reserva_por_vencer', 'bodeguero'
  UNION ALL SELECT 'resumen_diario', 'gerente'
  UNION ALL SELECT 'resumen_semanal', 'gerente'
) t ON t.rol = r.codigo;

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('avisos.configurar', 'base', 'ENCENDER Y APAGAR LOS AVISOS, CAMBIAR SUS TEXTOS Y ELEGIR A QUIEN LES LLEGAN');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'avisos.configurar' FROM roles r WHERE r.codigo IN ('administrador', 'gerente');
