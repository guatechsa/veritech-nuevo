# 04 — Equipos · backend (leído COMPLETO) — frontend pendiente

Leído: `equipmentController` (1.371), `routes/equipments` (180), `equipoHistorialService` (300), `equipoQrController` (62), `equipoMaterialesController` (147), `equipoNotificationService` (68), `routes/publicEquipo` (34), cabecera de `utils/equipoHistorialHtml` (171) y el esquema de `equipos`, `equipo_contadores`, `equipment_photos`, `equipment_documents`, `equipment_notes`, `equipo_materiales`. Pendiente: frontend (`Equipments.tsx` 910, `EquipmentDetailModal.tsx` 2.281, `EquipoQrModal` 157, `EtiquetasQrLoteModal` 178, `QRScanner` 174, `condicionUi` 99, `MaterialEquiposSelector` 116) y la parte de contadores (módulo 5).

## Qué hace (se conserva)
- **Un equipo es "cualquier maquinaria sujeta a mantenimiento"** (así lo dice la propia tabla): marca, modelo, año, número de serie (VIN), motor (serie, marca, modelo, descripción), tipo de equipo (catálogo), color, cliente dueño, departamento del cliente, propiedad (propio / renta / leasing), estado (activo / inactivo), código interno, notas.
- **Todo equipo debe tener al menos un contador** (km, horas, ciclos, días…). Crear o editar un equipo crea o actualiza sus contadores.
- La marca se valida contra el catálogo del tipo de equipo (una marca puede pertenecer a varios tipos; si la marca no está en el catálogo se acepta como libre).
- El departamento debe ser del mismo cliente del equipo.
- Fotos (con foto principal), documentos con fecha de vencimiento, notas (importantes primero), materiales aplicables (los usados en órdenes + los asignados a mano).
- Detalle del equipo: estadísticas de órdenes, últimas 20 lecturas, últimas 10 órdenes (solo las de la sucursal del usuario).
- **QR de historial público (V3.094):** código por equipo (`<empresa en base 36>-<10 al azar>`), página sin sesión que muestra solo órdenes terminadas/entregadas/cerradas, sin precios, costos, horas, notas, fotos, técnicos, cliente ni taller externo; regenerar invalida el QR impreso; etiquetas por lote (hasta 200).
- Aviso de vencimientos: primero al operador asignado, si no al cliente dueño.

## Hallazgos
1. **Crear un equipo no es atómico y puede dejar un equipo sin contador.** `createEquipment` inserta el equipo y *después* crea los contadores uno por uno; si uno falla responde 400 pero el equipo ya quedó guardado, incumpliendo la regla "todo equipo tiene al menos un contador". Lo mismo en `updateEquipment` (desactiva contadores, actualiza, crea…). Va todo en una transacción.
2. **Editar reescribe todo con valores por defecto.** `updateEquipment` es un reemplazo total: lo que no se manda se guarda como `NULL`, o como `'Gasolina'`, `'km/gal'` y `0`. Un cliente de la API que mande solo la placa borra el resto. Hoy la pantalla manda todo, así que no se ve.
3. **El modelo del equipo está pensado para vehículos, no para "cualquier maquinaria".**
   - `plate` (placa), `vin`, `fuel_type` (Gasolina / Diésel / Eléctrico / Híbrido, **por defecto Gasolina**), `capacidad_tanque_galones`, `rendimiento_combustible` y su unidad (km/gal, mi/gal, gal/hr), tipos de documento "tarjeta de circulación" y "calcomanía". Un horno o una bomba quedarían marcados "Gasolina".
   - `coverage_type` (cobertura de seguro RC / TOTAL) solo lo toca este controlador y un tipo del frontend: **campo muerto**.
   - `odometer`, `hours`, `mileage` están marcados "DEPRECATED: usar equipo_contadores" en el esquema, pero el controlador los sigue escribiendo en cada guardado.
4. **Identificación del equipo confusa:** el VIN/serie es obligatorio y único; la placa es opcional y única en TODO el taller (un mismo número no puede repetirse ni entre clientes); el código interno es único solo por cliente. El mensaje de error dice "VIN o placa" sin decir cuál.
5. **`valor_actual` de un contador se calcula en tres lugares con tres fórmulas:** `GREATEST(valor_actual, valor_inicial, máx. lectura)` en el listado, otra en el detalle y una más en la ficha. El valor guardado no es confiable por sí solo (módulo 5).
6. **Fotos, documentos y notas se borran sin comprobar de qué equipo son** (`DELETE /photos/:photoId` ignora el `:id`), y al borrar el registro **el archivo queda en el disco** (se acumulan archivos huérfanos). "Foto principal" hace dos `UPDATE` sin transacción: con un `photoId` equivocado el equipo se queda sin foto principal.
7. **Se descarga todo el parque de equipos con sus contadores en una sola respuesta** (sin paginación) y con una consulta extra por la lectura máxima; además `SHOW COLUMNS` y `hasTable('departamentos')` en cada petición.
8. **Roles por nombre:** el router bloquea escrituras al rol `operator` mirando el nombre del rol, además de los permisos reales; los dos mecanismos conviven.
9. **Fechas:** `normalizeDateOnly` usa `toISOString().slice(0, 10)` (fecha en UTC), el patrón que el propio `CLAUDE.md` prohíbe porque entre las 6 p. m. y la medianoche de Guatemala da el día siguiente.
10. **Descripción de documento limitada a 25 caracteres** (límite arbitrario); permisos de borrado de fotos/docs/notas atados a `crud.equipments.delete`.
11. **QR público:** el código lleva el id de la empresa y la consulta pública abre el contexto del taller con el mecanismo invisible (se rehace con la conexión explícita); hay una columna `lecturas … <> 'combustible'` y el filtro `tipo_lectura` por un módulo que ya no existe.
12. **Duplicado de equipos y materiales:** `equipo_materiales` y los materiales "usados en órdenes" se unen a mano en cada consulta.

## Diseño nuevo (propuesta)
- **Identificación:** `codigo` (interno, obligatorio, único por cliente), `numero_serie` (VIN o serie, opcional pero único cuando existe), `placa` **solo cuando el tipo de equipo lo pide** (el tipo de equipo lleva la bandera "usa placa" y "usa combustible").
- Se eliminan `coverage_type`, `odometer`, `hours`, `mileage`; combustible solo si el tipo de equipo lo usa, sin valor por defecto.
- Crear/editar equipo + contadores en una **transacción**; edición parcial (solo lo que se manda).
- Fotos/documentos/notas bajo la ruta del equipo, verificando que le pertenecen y borrando el archivo con el registro.
- Listado paginado con búsqueda en el servidor; el valor actual del contador sale de una sola fuente (módulo 5).
- QR: igual que hoy, resolviendo el taller con la conexión explícita.

## Decisión necesaria de Luis
**¿Cómo identificar un equipo?** Recomiendo: *código interno* obligatorio (único por cliente), *número de serie* opcional pero único si se pone, y *placa* solo para los tipos de equipo marcados como vehículos. Así un horno industrial no necesita placa ni "VIN". Falta confirmar con el frontend si el combustible (tipo, capacidad, rendimiento) se sigue mostrando en alguna pantalla.

---
# Decisión de Luis (2026-11-10): **identificación del equipo:** código interno obligatorio (único por cliente) + número de serie/VIN opcional pero único si se escribe + placa solo cuando el tipo de equipo está marcado como vehículo.

---
# Adenda — frontend de equipos leído COMPLETO (2026-11-10)
Leído: `Equipments.tsx` (910), `EquipmentDetailModal.tsx` (2.281), `EquipoQrModal` (157), `EtiquetasQrLoteModal` (178), `QRScanner` (174). Quedan para su módulo: `ContadoresEditor`, `EquipmentContadores`, `ContadoresAuxiliaresPanel`, `condicionUi` (módulo 5) y `MaterialEquiposSelector` (módulo 8, Inventario).

## Qué hace la pantalla (se conserva)
- Listado con ID, placa, número interno, tipo, marca/modelo, año, cliente, departamento, propiedad, contadores, valor actual, estado, y acciones Ver / Editar / Eliminar.
- Alta en ventana de 5 pestañas (General, Motor, Combustible, Contadores, Cliente); ficha con 10 pestañas (más Contadores auxiliares, Docs, Materiales, Notas, Fotos), órdenes recientes y lecturas.
- **Regla importante que SÍ se conserva:** el **tipo de equipo no se puede cambiar** después de crearlo (cambiarlo invalidaría checklists, paquetes y órdenes ya hechos con las plantillas del tipo anterior; si el tipo está mal se desactiva el equipo y se crea otro).
- Fotos con cámara del navegador o archivo, foto principal, documentos con cámara o PDF, notas con "importante", botón QR (generar, imprimir, descargar, copiar enlace, regenerar, desactivar) y etiquetas QR por lote, "Corregir" una lectura de contador.

## Hallazgos
1. **Dos formularios para lo mismo.** Crear vive en `Equipments.tsx` y editar en `EquipmentDetailModal.tsx`; el estado de ~20 campos, la validación y el armado del envío están **copiados** en los dos. El estándar §7 pide "crear y editar, el mismo patrón". Además la ficha repite su lista de pestañas una vez para ver y otra para editar.
2. **Código muerto confirmado:** el escáner de QR/código de barras (`QRScanner.tsx`, 174 renglones, más la librería `html5-qrcode` y su buscador por VIN/placa) **no se puede abrir nunca**: `setShowQRScanner(true)` no existe en ninguna parte. Y aunque se abriera, los QR que se imprimen llevan el enlace público del historial, no el VIN.
3. **"Faltantes" de documentos escritos para vehículos y obligatorios para todos.** La campana roja de la ficha pide siempre 8 documentos: póliza de seguro, calcomanía, tarjeta de circulación, factura, manual de operación, manual de reparación, garantía y contrato. Un horno o una bomba queda con 8 pendientes permanentes. La lista de tipos de documento también es de vehículo.
4. **La fecha de vencimiento de un documento se captura y nunca se usa:** no aparece en la lista de documentos de la ficha y ninguna alerta ni reporte la lee (la tabla `equipment_documents` no se consulta en ningún otro archivo del servidor). Pedir la fecha sin avisar del vencimiento es una promesa vacía.
5. **El combustible sigue ahí aunque el módulo se quitó:** pestaña "Combustible" con "Control de Combustible", tipo (por defecto Gasolina), capacidad y rendimiento en la ficha de **todo** equipo, y una etiqueta "Combustible" en el historial de lecturas.
6. **Errores que el usuario no ve:** al subir una foto o un documento, o al borrar fotos, documentos y notas, si falla solo se escribe en la consola del navegador; la pantalla no dice nada.
7. **Dos copias del código de la cámara** (una para fotos y otra para documentos, ~120 renglones cada una) y el componente de ficha tiene 2.281 renglones y ~50 variables de estado.
8. **Nombres inconsistentes:** "Matrícula" en la ficha y "Placa" en el listado y el formulario; "ID interno" / "Número interno" / "Código Interno"; el título dice "EQUIPO # 47" con el número de la base de datos en vez del código del equipo.
9. **El campo VIN es obligatorio en pantalla** (asterisco), el cliente también, y el mensaje de error es una pregunta sin decir qué falta: "Debe de completar los campos obligatorios para continuar?".
10. **Marca solo del catálogo en pantalla, libre en la API:** el desplegable no deja escribir una marca fuera del catálogo (solo conserva la actual al editar), pero el servidor sí la acepta.
11. **Dos formas de desactivar un equipo** (campo "Estado" al editar y botón "Desactivar") y un borrado definitivo desde el listado, con la misma palabra "Eliminar".
12. **Listado:** descarga todo el parque (`?_=hora` para saltarse la caché), los "50/100/Todos" solo recortan en el navegador, y cuenta contadores "legacy" (`odometer`, `hours`) además de los reales.
13. **Estados por texto:** la insignia de estado de una orden se colorea buscando el nombre exacto ("En proceso", "En revisión", "Facturada"…); un estado propio queda siempre azul.

## Diseño nuevo
- Un solo formulario de equipo (crear y editar) con las mismas secciones; la ficha es de lectura con botón Editar que abre ese mismo formulario.
- Pestaña Combustible solo si el tipo de equipo "usa combustible"; campo Placa solo si el tipo es vehículo (decidido arriba).
- **Documentos requeridos y avisos de vencimiento por tipo de equipo** (configurable): el tipo define qué documentos se piden (puede ser ninguno) y cuáles vencen; los que tengan fecha generan aviso por correo y marca en la ficha.
- Un solo componente de cámara/archivo para fotos y documentos, con mensajes de error visibles.
- Se elimina `QRScanner` y la dependencia `html5-qrcode`. Si se quiere buscar por código se hace con el buscador de la lista (que ya filtra por código, serie y placa).
- Listado paginado en el servidor; título de la ficha con el código del equipo.

## Decisión necesaria de Luis
**Documentos del equipo:** recomiendo que **cada tipo de equipo defina qué documentos se piden** (un camión: seguro, tarjeta de circulación, calcomanía; un horno: manual y garantía) y que **cualquier documento con fecha de vencimiento avise por correo** antes de vencer. Hoy se piden los mismos 8 a todos y la fecha de vencimiento no sirve para nada.

---
# Aclaración pendiente (2026-11-10): ¿cuál es "el identificador" del equipo?
Luis dice que el identificador es el "equipment_ID". Verificado en el código: **no existe ningún campo llamado `equipment_id`**. La llave real es `equipos.id` (número automático), que otras 42 tablas usan como `equipo_id`, y es lo que la pantalla muestra como columna "ID" y como título "EQUIPO # n". (`equipment_type_id` en la API es en realidad el CÓDIGO del tipo de equipo, un nombre engañoso.) La propuesta de "código interno obligatorio + serie + placa" era sobre lo que escribe una persona; falta confirmar si el número automático debe ser ADEMÁS el identificador visible (etiquetas, búsquedas, órdenes) o si el cliente usa su propio código. Decisión previa registrada arriba queda en revisión hasta que Luis responda.

---
# Decisión de Luis (2026-11-10), reemplaza la de identificación: **la llave del equipo es el número automático (`id`); el código interno que usa la empresa es OPCIONAL** (único por cliente cuando se escribe). Número de serie opcional y único si se escribe; placa solo si el tipo de equipo es vehículo. El título de la ficha sigue siendo "EQUIPO # n".
