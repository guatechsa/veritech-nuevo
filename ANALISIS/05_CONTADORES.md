# 05 — Contadores (principales y auxiliares) · LEÍDO COMPLETO (backend + frontend)

Leído: `contadorLecturaService` (527), `contadorController` (683), `routes/contadores` (201), `contadorAuxiliarController` (315), `condicionService` (363), `condicionAlertService` (94), `routes/contadoresAuxiliares` (35) y `ContadorLecturaForm.tsx` (246). **Pendiente del frontend:** `Contadores.tsx` (220), `EquipmentContadores` (590), `ContadoresAuxiliaresPanel` (575), `ContadoresEditor` (315), `OTContadores` (149), `condicionUi` (99) y `utils/unidadesContador`. El barrido diario de alertas (`maintenanceAlertScheduler`) y la proyección (`proyeccionService`) se leen en el módulo 10.

## Qué hace (se conserva)
- Cada equipo tiene al menos un contador (km, millas, horas, ciclos, días, meses). Los de **calendario** (días/meses) no se leen a mano: el tiempo transcurrido se calcula desde la fecha de inicio.
- Toda lectura queda en un historial (`ot_contadores_lecturas`) con fecha, quién la registró, notas y foto de evidencia; origen: inicial, entrada de orden, checklist o manual.
- **Lectura obligatoria al recibir el equipo** (orden en taller o llegada de una cita): una por contador, con foto.
- El ritmo de uso diario se calcula con el historial real dentro de una ventana (método de mitades cronológicas) y alimenta "Próximas fechas".
- Una estrategia de mantenimiento o paquete de inspección solo puede asignarse a un contador de **la misma unidad**.
- **Contadores auxiliares (V3.103):** mediciones de condición de un componente (análisis de aceite, desgaste…) con límite de precaución y condenatorio, tendencia por mínimos cuadrados contra el contador principal, proyección de fecha, aviso por correo con deduplicación. El código es reciente y está bien hecho: se conserva casi tal cual.

## Hallazgos
1. **Un valor mal escrito no se puede corregir.** Tanto el servidor como el formulario rechazan una lectura menor a la actual (por ejemplo 100.000 en vez de 10.000), y el botón se llama **"Corregir"** pero solo registra una lectura nueva igual o mayor. Una lectura con un cero de más deja el contador trabado para siempre y arruina los cálculos de ritmo y de próximo mantenimiento; hoy solo se arregla tocando la base de datos. Los auxiliares sí tienen "eliminar toma"; los principales no tienen nada.
2. **El concepto está mezclado: "contador" es a la vez el medidor físico y el plan de mantenimiento.** Para que un mismo odómetro alimente dos planes (por ejemplo "GENERAL-MI" y "MOTOR-MI") se crean dos contadores y el sistema los "sincroniza" por tener la misma unidad: el servidor copia el valor a los hermanos sin dejar lectura en su historial, y la pantalla repite la lectura **una petición por hermano** (con la foto subida varias veces; si una falla, queda a medias: "no se pudo aplicar a 1 contador hermano"). Si un equipo tuviera dos horómetros distintos (motor y bomba) quedarían sincronizados por error.
3. **`valor_actual` es un número copiado que puede desincronizarse.** Se guarda en el contador y se actualiza en una segunda sentencia después de insertar la lectura, sin transacción; y se recalcula con `GREATEST(…)` en el listado, el detalle y la ficha. El historial debe ser la única fuente.
4. **Regla de lectura contradictoria:** `registrarLecturaContador` acepta una lectura **igual** a la actual, pero la orden de trabajo exige **estrictamente mayor**: un equipo que no se movió entre dos visitas no puede abrir una orden.
5. **Dos sistemas de mantenimiento a la vez.** El contador trae `frecuencia_mantenimiento` (un número) y además puede tener una estrategia con niveles. La ficha del equipo y la lectura en la orden calculan "próximo mantenimiento = valor actual + frecuencia", sin saber cuándo fue el último servicio; el cálculo bueno está en la proyección por estrategia. La frecuencia suelta es herencia.
6. **Tres fórmulas de "ritmo de uso":** la del listado de contadores (`(actual − inicial) / días desde el inicio`), la de la proyección (ventana móvil) y la de la ficha. Pueden mostrar números distintos para el mismo contador.
7. **Límite fijo de 3 contadores por equipo** (orden 1 a 3) sin razón de negocio documentada.
8. **Foto de evidencia por dos caminos:** en la orden llega como texto en base64 dentro del JSON (peso extra y límite de 10 MB del cuerpo) y en el resto como archivo; son dos implementaciones de lo mismo.
9. **Código y reglas heredadas:** `catalog_contador_unidad` en consultas (unidades unidas por decisión), etiqueta `combustible` en lecturas, `try/catch` por tabla inexistente.
10. **Eficiencia:** el aviso manual de un auxiliar carga las condiciones de **todos** los equipos para quedarse con una; `eliminarToma` borra por identificador sin comprobar el equipo ni dejar rastro.
11. `dias_desde_inicio` y la fecha por defecto se calculan con la hora del servidor (`NOW()`/`CURDATE()`), mezcla con las fechas en UTC de otros puntos.

## Diseño nuevo (propuesta)
- **Separar el medidor del plan.** `medidores` (odómetro, horómetro, ciclos…): una sola serie de lecturas por medidor; `planes_de_medidor` (estrategia de mantenimiento y/o paquete de inspección asignados a un medidor). Dos planes sobre el mismo odómetro = un medidor con dos planes. Desaparecen la sincronización por unidad, las lecturas repetidas por hermano y el tope de 3.
- El valor actual **se deriva** de la última lectura válida (columna calculada o vista), nunca se copia a mano.
- **Corrección con rastro:** quien tenga permiso puede *anular* una lectura equivocada (queda marcada, con quién y por qué); el valor actual pasa a la mejor lectura vigente; nunca se borra el historial.
- Regla única de lectura: no puede ser menor a la anterior **vigente**; una igual se acepta.
- Mantenimiento solo por estrategia/paquete (se elimina `frecuencia_mantenimiento`).
- Evidencia siempre como archivo, mismo componente para orden, checklist y lectura manual.
- Auxiliares se conservan y se enlazan al medidor.

## Decisiones necesarias de Luis
1. **¿Separamos medidor y plan?** Recomiendo que sí (explicación arriba). Necesito confirmar un dato: **¿es cierto que un mismo odómetro/horómetro puede tener dos planes de mantenimiento distintos** (por ejemplo uno general y otro del motor)? El código y su comentario dicen que sí.
2. **¿Se permite corregir (anular) una lectura equivocada**, con rastro de quién y por qué, y solo para quien tenga el permiso? Recomiendo que sí.

---
# Decisiones de Luis (2026-11-10)
1. **Un mismo medidor (odómetro/horómetro) SÍ puede tener varios planes de mantenimiento** (ej. general y de motor) → se separa el MEDIDOR del PLAN.
2. **Se permite ANULAR una lectura equivocada**, con rastro (quién, cuándo, por qué), solo con el permiso correspondiente; el historial nunca se borra y el valor actual pasa a la mejor lectura vigente.

---
# Adenda — frontend de contadores leído COMPLETO (2026-11-10)
Leído: `ContadorLecturaForm` (246), `Contadores.tsx` (220), `EquipmentContadores` (590), `ContadoresEditor` (315), `ContadoresAuxiliaresPanel` (575), `OTContadores` (149), `condicionUi` (99). Con esto el módulo 5 queda leído completo (backend + frontend).

## Hallazgos del frontend
1. **`EquipmentContadores.tsx` (590 renglones) es código muerto confirmado:** ningún archivo lo importa. Tenía las 3 "casillas" fijas y la frecuencia heredada; se descarta entero.
2. **Dos pantallas se contradicen sobre cuántos contadores caben.** El encabezado de `ContadoresEditor` dice "sin límite", pero el servidor rechaza el cuarto contador (tope de 3, orden 1 a 3). Quien lo intente ve un error sin explicación.
3. **`OTContadores` (la lectura dentro de la orden) solo muestra datos** y calcula el "Intervalo de mantenimiento" con la `frecuencia` heredada, no con la estrategia real; la columna "ID" muestra `numero_contador || id` (a veces el número de la base de datos), y el nombre se arma pegando `tipo-unidad` (por ejemplo "ODOMETRO-KM").
4. **`ContadorLecturaForm`:** el campo tiene `min = valor actual` y valida otra vez en código, así que el navegador impide escribir un valor menor aunque el servidor tuviera una excepción; y manda **una petición por contador hermano** (la foto se sube varias veces; si una falla, queda a medias).
5. **Auxiliares (`ContadoresAuxiliaresPanel`) bien hechos, con tres reparos:** (a) "Eliminar toma" borra para siempre y sin rastro (confirmación + `DELETE`), distinto de lo decidido para los principales (anular con rastro); (b) "Quitar" y "Eliminar" son botones con acciones muy distintas pero se parecen; (c) el valor del contador principal de la toma lo escribe la persona (tope: la lectura actual), no se toma de la lectura vigente del medidor en esa fecha.
6. **`condicionUi`:** el tipo `CondicionRow` mezcla nombres en inglés (`plate`, `brand`, `model`, `year`, `internal_code`) con español, y "3 tomas" mínimas está escrito fijo en el texto de la pantalla (debe venir de la misma constante que usa el servidor).
7. **Nombres y fechas:** se usa `localToday()` en los auxiliares (bien: fecha local, no UTC), pero `OTContadores` y otras pantallas muestran fechas con `formatDate` sin garantía del formato DD/MM/YYYY de GUATECH_STANDARDS §18 (se comprobará al construir).

## Diseño nuevo (completa lo anterior)
- Una sola pantalla de **Medidores del equipo**: lista de medidores (nombre, unidad, valor vigente, fecha de la última lectura), botón "Registrar lectura" (una sola petición, una sola foto), "Anular lectura" con motivo y, debajo de cada medidor, sus **planes** (estrategia/paquete, intervalo, próximo vencimiento calculado). Sin límite de medidores.
- La lectura dentro de la orden usa el mismo componente de registro; muestra el próximo mantenimiento **desde la estrategia**, no desde una frecuencia suelta.
- Auxiliares: se conservan; "Eliminar toma" pasa a **Anular toma** con rastro, igual que los medidores; el valor del medidor principal de la toma se **deriva** de la lectura vigente más cercana a la fecha de la toma, con opción de corregirlo.
- Se descarta: `EquipmentContadores`, la frecuencia heredada, las casillas fijas 1–3, la sincronización por unidad y la petición por hermano.

## Estado del módulo 5
**Leído completo (backend + frontend).** Decisiones de Luis ya registradas arriba (medidor ≠ plan; anular lecturas con rastro). Pendiente de módulos posteriores: el barrido diario de alertas y la proyección (módulo 10).
