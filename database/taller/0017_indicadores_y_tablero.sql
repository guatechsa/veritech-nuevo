-- Fase 7a: indicadores con metas (semáforo) y tablero de inicio por rol.
-- Los indicadores y las tarjetas se definen en el código (una sola definición para tablero, reportes y alertas); aquí solo vive lo que
-- cada empresa decide: sus metas y qué tarjetas ve cada rol.

CREATE TABLE metas_indicadores (
  indicador VARCHAR(40) NOT NULL,
  sentido ENUM('mayor','menor') NOT NULL COMMENT 'mayor: entre más alto mejor; menor: entre más bajo mejor',
  meta DECIMAL(14,2) NOT NULL COMMENT 'verde si se cumple',
  limite DECIMAL(14,2) NULL COMMENT 'amarillo hasta aquí; más allá es rojo (vacío: sin amarillo)',
  actualizado_por_id INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (indicador),
  CONSTRAINT fk_metas_usuario FOREIGN KEY (actualizado_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Si un rol no tiene filas aquí, ve las tarjetas sugeridas para su tipo de rol; si tiene, ve solo las marcadas.
CREATE TABLE tablero_roles (
  rol_id INT UNSIGNED NOT NULL,
  tarjeta VARCHAR(40) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (rol_id, tarjeta),
  CONSTRAINT fk_tablero_roles_rol FOREIGN KEY (rol_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('reportes.ver',  'reportes', 'VER LOS INDICADORES Y REPORTES OPERATIVOS (SIN DINERO)'),
  ('reportes.financieros', 'reportes', 'VER LOS INDICADORES Y REPORTES CON DINERO (VENTAS, TICKET, MARGEN)'),
  ('reportes.exportar',    'reportes', 'EXPORTAR REPORTES A EXCEL Y PDF'),
  ('reportes.configurar',  'reportes', 'DEFINIR LAS METAS DE LOS INDICADORES Y LAS TARJETAS DEL TABLERO DE CADA ROL');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo IN ('administrador', 'gerente') AND p.codigo LIKE 'reportes.%';
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, p.codigo FROM roles r JOIN permisos p WHERE r.codigo = 'supervisor' AND p.codigo IN ('reportes.ver', 'reportes.exportar');
INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'reportes.ver' FROM roles r WHERE r.codigo IN ('bodeguero', 'recepcionista', 'visualizador');
