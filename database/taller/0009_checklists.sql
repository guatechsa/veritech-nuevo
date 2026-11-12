-- Taller, migración 0009: checklists (Fase 4d).
-- Plantillas VERSIONADAS (lo ya completado nunca cambia), respuestas que COPIAN el texto del ítem, fotos (hasta 5 por ítem),
-- firma del cliente, candado de checklist completado y checklists requeridos por tipo de orden (que bloquean o solo avisan).

-- Etapas que faltaban (la tanda 2 aprobó: OPERACIÓN —no requiere orden—, RECEPCIÓN, MANTENIMIENTO, CALIDAD, ENTREGA).
INSERT INTO etapas (codigo, nombre, orden, requiere_orden, color) VALUES
  ('OPERACION', 'OPERACION', 5, 0, '#6B7280'),
  ('MANTENIMIENTO', 'MANTENIMIENTO', 15, 1, '#7C3AED');

CREATE TABLE checklist_tipos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  descripcion VARCHAR(250) NULL,
  etapa_id INT UNSIGNED NOT NULL,
  exige_lectura_contador TINYINT(1) NOT NULL DEFAULT 0,
  requiere_firma_cliente TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_tipos_codigo (codigo),
  UNIQUE KEY uq_checklist_tipos_nombre (nombre),
  CONSTRAINT fk_checklist_tipos_etapa FOREIGN KEY (etapa_id) REFERENCES etapas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A qué tipos de equipo aplica un tipo de checklist (sin filas = a todos).
CREATE TABLE checklist_tipo_tipos_equipo (
  checklist_tipo_id INT UNSIGNED NOT NULL,
  tipo_equipo_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (checklist_tipo_id, tipo_equipo_id),
  CONSTRAINT fk_ctte_tipo FOREIGN KEY (checklist_tipo_id) REFERENCES checklist_tipos (id),
  CONSTRAINT fk_ctte_equipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_plantillas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  checklist_tipo_id INT UNSIGNED NOT NULL,
  version SMALLINT UNSIGNED NOT NULL,
  vigente TINYINT(1) NOT NULL DEFAULT 0,
  creada_por_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_plantillas_version (checklist_tipo_id, version),
  CONSTRAINT fk_checklist_plantillas_tipo FOREIGN KEY (checklist_tipo_id) REFERENCES checklist_tipos (id),
  CONSTRAINT fk_checklist_plantillas_usuario FOREIGN KEY (creada_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_secciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plantilla_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_checklist_secciones (plantilla_id, orden),
  CONSTRAINT fk_checklist_secciones_plantilla FOREIGN KEY (plantilla_id) REFERENCES checklist_plantillas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plantilla_id INT UNSIGNED NOT NULL,
  seccion_id INT UNSIGNED NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  descripcion VARCHAR(250) NOT NULL,
  tipo_respuesta ENUM('semaforo','si_no','numero','texto','lista') NOT NULL DEFAULT 'semaforo',
  unidad_id INT UNSIGNED NULL,
  minimo DECIMAL(12,2) NULL,
  maximo DECIMAL(12,2) NULL,
  PRIMARY KEY (id),
  KEY ix_checklist_items (plantilla_id, seccion_id, orden),
  CONSTRAINT fk_checklist_items_plantilla FOREIGN KEY (plantilla_id) REFERENCES checklist_plantillas (id),
  CONSTRAINT fk_checklist_items_seccion FOREIGN KEY (seccion_id) REFERENCES checklist_secciones (id),
  CONSTRAINT fk_checklist_items_unidad FOREIGN KEY (unidad_id) REFERENCES unidades (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_item_opciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id INT UNSIGNED NOT NULL,
  texto VARCHAR(100) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_checklist_item_opciones (item_id, orden),
  CONSTRAINT fk_checklist_item_opciones_item FOREIGN KEY (item_id) REFERENCES checklist_items (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un checklist lleno (o por llenar). Sin orden = checklist de operación (por ejemplo, la revisión diaria del operador).
-- `abierto_clave` impide tener dos abiertos del mismo tipo en la misma orden.
CREATE TABLE checklists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_id INT UNSIGNED NOT NULL,
  plantilla_id INT UNSIGNED NOT NULL,
  orden_id INT UNSIGNED NULL,
  equipo_id INT UNSIGNED NOT NULL,
  estado ENUM('pendiente','en_progreso','completado') NOT NULL DEFAULT 'pendiente',
  completado_en DATETIME NULL,
  completado_por_id INT UNSIGNED NULL,
  creado_por_id INT UNSIGNED NULL,
  lectura_contador_id INT UNSIGNED NULL,
  excepcion_motivo_id INT UNSIGNED NULL,
  abierto_clave VARCHAR(40) GENERATED ALWAYS AS (IF(estado <> 'completado' AND orden_id IS NOT NULL, CONCAT(orden_id, ':', tipo_id), NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklists_abierto (abierto_clave),
  KEY ix_checklists_orden (orden_id, estado),
  KEY ix_checklists_equipo (equipo_id),
  CONSTRAINT fk_checklists_tipo FOREIGN KEY (tipo_id) REFERENCES checklist_tipos (id),
  CONSTRAINT fk_checklists_plantilla FOREIGN KEY (plantilla_id) REFERENCES checklist_plantillas (id),
  CONSTRAINT fk_checklists_orden FOREIGN KEY (orden_id) REFERENCES ordenes (id),
  CONSTRAINT fk_checklists_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_checklists_completado_por FOREIGN KEY (completado_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_checklists_creado_por FOREIGN KEY (creado_por_id) REFERENCES usuarios (id),
  CONSTRAINT fk_checklists_lectura FOREIGN KEY (lectura_contador_id) REFERENCES lecturas_contador (id),
  CONSTRAINT fk_checklists_motivo FOREIGN KEY (excepcion_motivo_id) REFERENCES motivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una respuesta COPIA la sección y la descripción del ítem: si la plantilla cambia después, lo completado no cambia.
CREATE TABLE checklist_respuestas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  checklist_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  seccion VARCHAR(100) NOT NULL,
  descripcion VARCHAR(250) NOT NULL,
  tipo_respuesta ENUM('semaforo','si_no','numero','texto','lista') NOT NULL,
  minimo DECIMAL(12,2) NULL,
  maximo DECIMAL(12,2) NULL,
  semaforo ENUM('verde','amarillo','rojo') NULL,
  si_no TINYINT(1) NULL,
  valor_numero DECIMAL(12,2) NULL,
  valor_texto VARCHAR(500) NULL,
  opcion_texto VARCHAR(100) NULL,
  nota VARCHAR(300) NULL,
  respondido_por_id INT UNSIGNED NULL,
  respondido_en DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_respuestas_item (checklist_id, item_id),
  KEY ix_checklist_respuestas (checklist_id, orden),
  CONSTRAINT fk_checklist_respuestas_checklist FOREIGN KEY (checklist_id) REFERENCES checklists (id),
  CONSTRAINT fk_checklist_respuestas_item FOREIGN KEY (item_id) REFERENCES checklist_items (id),
  CONSTRAINT fk_checklist_respuestas_usuario FOREIGN KEY (respondido_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_fotos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  respuesta_id INT UNSIGNED NOT NULL,
  archivo_id INT UNSIGNED NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_checklist_fotos (respuesta_id),
  CONSTRAINT fk_checklist_fotos_respuesta FOREIGN KEY (respuesta_id) REFERENCES checklist_respuestas (id),
  CONSTRAINT fk_checklist_fotos_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Qué checklists pide cada tipo de orden, y cuándo: antes de iniciar un trabajo o antes de cerrar la orden. «bloquear» es lo normal.
CREATE TABLE checklists_requeridos (
  tipo_orden_id INT UNSIGNED NOT NULL,
  checklist_tipo_id INT UNSIGNED NOT NULL,
  momento ENUM('antes_de_iniciar','antes_de_terminar') NOT NULL,
  accion ENUM('bloquear','avisar') NOT NULL DEFAULT 'bloquear',
  PRIMARY KEY (tipo_orden_id, checklist_tipo_id, momento),
  CONSTRAINT fk_checklists_req_orden FOREIGN KEY (tipo_orden_id) REFERENCES tipos_orden (id),
  CONSTRAINT fk_checklists_req_tipo FOREIGN KEY (checklist_tipo_id) REFERENCES checklist_tipos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Firma del cliente (dibujada con el dedo), solo en los tipos que la piden (Recepción y Entrega).
CREATE TABLE firmas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  checklist_id INT UNSIGNED NOT NULL,
  firmante_nombre VARCHAR(120) NOT NULL,
  archivo_id INT UNSIGNED NOT NULL,
  firmado_en DATETIME NOT NULL,
  dispositivo VARCHAR(200) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_firmas_checklist (checklist_id),
  CONSTRAINT fk_firmas_checklist FOREIGN KEY (checklist_id) REFERENCES checklists (id),
  CONSTRAINT fk_firmas_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Plantillas básicas sembradas (editables): RECEPCIÓN, CALIDAD y ENTREGA ──
INSERT INTO checklist_tipos (codigo, nombre, descripcion, etapa_id, exige_lectura_contador, requiere_firma_cliente)
SELECT 'RECEPCION', 'RECEPCION DEL EQUIPO', 'ESTADO EN QUE LLEGA EL EQUIPO', e.id, 1, 1 FROM etapas e WHERE e.codigo = 'RECEPCION'
UNION ALL SELECT 'CALIDAD', 'CONTROL DE CALIDAD', 'REVISION FINAL ANTES DE ENTREGAR', e.id, 0, 0 FROM etapas e WHERE e.codigo = 'CALIDAD'
UNION ALL SELECT 'ENTREGA', 'ENTREGA DEL EQUIPO', 'ESTADO EN QUE SE ENTREGA EL EQUIPO', e.id, 1, 1 FROM etapas e WHERE e.codigo = 'ENTREGA';

INSERT INTO checklist_plantillas (checklist_tipo_id, version, vigente) SELECT id, 1, 1 FROM checklist_tipos;

INSERT INTO checklist_secciones (plantilla_id, nombre, orden)
SELECT p.id, s.nombre, s.orden FROM checklist_plantillas p JOIN checklist_tipos t ON t.id = p.checklist_tipo_id
JOIN (SELECT 'RECEPCION' AS codigo, 'EXTERIOR' AS nombre, 1 AS orden UNION ALL SELECT 'RECEPCION', 'INTERIOR Y CABINA', 2
      UNION ALL SELECT 'CALIDAD', 'TRABAJO REALIZADO', 1 UNION ALL SELECT 'CALIDAD', 'LIMPIEZA Y PRUEBAS', 2
      UNION ALL SELECT 'ENTREGA', 'EXTERIOR', 1 UNION ALL SELECT 'ENTREGA', 'DOCUMENTOS Y ACCESORIOS', 2) s ON s.codigo = t.codigo;

INSERT INTO checklist_items (plantilla_id, seccion_id, orden, descripcion, tipo_respuesta)
SELECT p.id, sec.id, i.orden, i.descripcion, i.tipo FROM checklist_plantillas p JOIN checklist_tipos t ON t.id = p.checklist_tipo_id
JOIN checklist_secciones sec ON sec.plantilla_id = p.id
JOIN (SELECT 'RECEPCION' AS codigo, 'EXTERIOR' AS seccion, 1 AS orden, 'CARROCERIA Y PINTURA' AS descripcion, 'semaforo' AS tipo
      UNION ALL SELECT 'RECEPCION', 'EXTERIOR', 2, 'LLANTAS', 'semaforo'
      UNION ALL SELECT 'RECEPCION', 'EXTERIOR', 3, 'LUCES', 'semaforo'
      UNION ALL SELECT 'RECEPCION', 'INTERIOR Y CABINA', 1, 'TABLERO Y TESTIGOS', 'semaforo'
      UNION ALL SELECT 'RECEPCION', 'INTERIOR Y CABINA', 2, 'TRAE OBJETOS DE VALOR DENTRO', 'si_no'
      UNION ALL SELECT 'CALIDAD', 'TRABAJO REALIZADO', 1, 'EL TRABAJO SOLICITADO QUEDO COMPLETO', 'si_no'
      UNION ALL SELECT 'CALIDAD', 'TRABAJO REALIZADO', 2, 'FUGAS O RUIDOS EXTRANOS', 'semaforo'
      UNION ALL SELECT 'CALIDAD', 'LIMPIEZA Y PRUEBAS', 1, 'PRUEBA DE FUNCIONAMIENTO', 'semaforo'
      UNION ALL SELECT 'CALIDAD', 'LIMPIEZA Y PRUEBAS', 2, 'LIMPIEZA DEL EQUIPO', 'semaforo'
      UNION ALL SELECT 'ENTREGA', 'EXTERIOR', 1, 'CARROCERIA Y PINTURA', 'semaforo'
      UNION ALL SELECT 'ENTREGA', 'EXTERIOR', 2, 'LUCES', 'semaforo'
      UNION ALL SELECT 'ENTREGA', 'DOCUMENTOS Y ACCESORIOS', 1, 'SE ENTREGAN LOS REPUESTOS CAMBIADOS', 'si_no'
      UNION ALL SELECT 'ENTREGA', 'DOCUMENTOS Y ACCESORIOS', 2, 'OBSERVACIONES PARA EL CLIENTE', 'texto') i
  ON i.codigo = t.codigo AND i.seccion = sec.nombre;

-- ── Permisos ──
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('checklists.ver',        'ordenes', 'VER CHECKLISTS'),
  ('checklists.llenar',     'ordenes', 'ABRIR Y LLENAR CHECKLISTS'),
  ('checklists.gestionar',  'ordenes', 'CREAR Y EDITAR TIPOS Y PLANTILLAS DE CHECKLIST Y SUS REQUISITOS'),
  ('checklists.excepcion',  'ordenes', 'AUTORIZAR UNA EXCEPCION PARA CERRAR UNA ORDEN SIN UN CHECKLIST REQUERIDO');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'checklists.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'supervisor' AND p.codigo IN ('checklists.ver', 'checklists.llenar', 'checklists.excepcion');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('tecnico', 'operador') AND p.codigo IN ('checklists.ver', 'checklists.llenar');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'recepcionista' AND p.codigo IN ('checklists.ver', 'checklists.llenar');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'checklists.ver' FROM roles r WHERE r.codigo IN ('bodeguero', 'visualizador');
