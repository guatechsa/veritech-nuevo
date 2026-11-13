-- Fase 6c: documentos emitidos. Una cuenta, un informe de checklist o una cotización se EMITE: se toma una instantánea de lo que decía en ese
-- momento y se guarda su PDF con un folio. NO son facturas. Si lo que muestran cambia, se emite una versión nueva que reemplaza a la anterior.

CREATE TABLE documentos_emitidos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo ENUM('cuenta','informe','cotizacion') NOT NULL,
  folio VARCHAR(30) NOT NULL COMMENT 'CTA-000001, INF-000001 o el número de la cotización',
  version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  orden_id INT UNSIGNED NULL,
  checklist_id INT UNSIGNED NULL,
  cotizacion_id INT UNSIGNED NULL,
  huella CHAR(64) NOT NULL COMMENT 'SHA-256 del contenido: si no cambió, no se emite otra versión',
  contenido LONGTEXT NOT NULL COMMENT 'la instantánea (JSON) de lo que decía el documento',
  archivo_id INT UNSIGNED NOT NULL,
  reemplaza_a_id INT UNSIGNED NULL,
  emitido_en DATETIME NOT NULL,
  emitido_por_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documentos_folio (folio, version),
  KEY ix_documentos_orden (orden_id, tipo),
  KEY ix_documentos_checklist (checklist_id),
  KEY ix_documentos_cotizacion (cotizacion_id),
  CONSTRAINT fk_documentos_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_documentos_checklist FOREIGN KEY (checklist_id) REFERENCES checklists (id),
  CONSTRAINT fk_documentos_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones (id),
  CONSTRAINT fk_documentos_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id),
  CONSTRAINT fk_documentos_reemplaza FOREIGN KEY (reemplaza_a_id) REFERENCES documentos_emitidos (id),
  CONSTRAINT fk_documentos_usuario FOREIGN KEY (emitido_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('documentos.ver',    'ordenes', 'VER Y DESCARGAR LOS DOCUMENTOS EMITIDOS (CUENTAS, INFORMES Y COTIZACIONES EN PDF)'),
  ('documentos.emitir', 'ordenes', 'EMITIR CUENTAS, INFORMES DE CHECKLIST Y COTIZACIONES EN PDF');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente', 'supervisor', 'recepcionista') AND p.codigo LIKE 'documentos.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'documentos.ver' FROM roles r WHERE r.codigo = 'visualizador';
