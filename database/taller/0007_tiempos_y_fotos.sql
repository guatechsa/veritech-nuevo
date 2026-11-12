-- Taller, migración 0007: tiempos reales de cada técnico y fotos de las líneas de la orden (Fase 4b).

-- Cada tramo realmente trabajado por un técnico en una línea. De aquí salen las horas reales (eficiencia y utilización).
-- La llave única `abierto_clave` hace cumplir en la base que un técnico NO puede tener dos trabajos en proceso a la vez.
CREATE TABLE registros_tiempo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  linea_id INT UNSIGNED NOT NULL,
  colaborador_id INT UNSIGNED NOT NULL,
  inicio DATETIME NOT NULL,
  fin DATETIME NULL,
  abierto_clave TINYINT(1) GENERATED ALWAYS AS (IF(fin IS NULL, 1, NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registros_tiempo_abierto (colaborador_id, abierto_clave),
  KEY ix_registros_tiempo_linea (linea_id),
  CONSTRAINT fk_registros_tiempo_linea FOREIGN KEY (linea_id) REFERENCES lineas_orden (id),
  CONSTRAINT fk_registros_tiempo_colaborador FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotos del trabajo: antes, durante y después. El archivo se registra en `archivos` y se entrega con dirección firmada.
CREATE TABLE linea_fotos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  linea_id INT UNSIGNED NOT NULL,
  archivo_id INT UNSIGNED NOT NULL,
  tipo ENUM('antes','durante','despues') NOT NULL DEFAULT 'durante',
  descripcion VARCHAR(150) NULL,
  subido_por_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_linea_fotos_linea (linea_id),
  CONSTRAINT fk_linea_fotos_linea FOREIGN KEY (linea_id) REFERENCES lineas_orden (id),
  CONSTRAINT fk_linea_fotos_archivo FOREIGN KEY (archivo_id) REFERENCES archivos (id),
  CONSTRAINT fk_linea_fotos_usuario FOREIGN KEY (subido_por_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trabajar las líneas propias (iniciar, pausar, terminar, fotos). Quien además puede editar órdenes lo hace en cualquier línea.
INSERT INTO permisos (codigo, modulo, descripcion) VALUES
  ('ordenes.trabajar', 'ordenes', 'TRABAJAR MIS LINEAS: INICIAR, PAUSAR, TERMINAR Y SUBIR FOTOS');

INSERT INTO rol_permisos (rol_id, permiso_codigo)
SELECT r.id, 'ordenes.trabajar' FROM roles r WHERE r.codigo IN ('administrador', 'gerente', 'supervisor', 'tecnico');
