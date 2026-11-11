# 03 — Clientes, proveedores, sucursales y áreas de trabajo (leído COMPLETO)

Leído: `clientController` (502), `proveedoresController` (175), `sucursalController` (112), `areaTrabajoController` (159), `sucursalAreaService` (68), `utils/sucursalScope` (149), las 4 rutas, `Clients.tsx` (489), `Proveedores.tsx` (156), `ProveedorFormModal` (181), `ProveedorPicker` (64), `SucursalesAreasPanel` (302), `TarifasAreaModal` (160), `useSucursalesAreas` (hook). ≈ 2.400 renglones.

## Qué hace (reglas que SÍ se conservan)
**Clientes:** nombre y teléfono obligatorios; NIT, correo, teléfono 2, contacto, dirección, ciudad, país, notas; **tipo de cliente** (descuentos); aviso (no bloqueo) de duplicados por correo/teléfono/NIT; no se puede borrar un cliente que tenga equipos u órdenes; ver equipos y órdenes de un cliente (las órdenes, solo las de la sucursal del usuario). **Departamentos del cliente** = áreas internas de la empresa dueña del equipo (Producción, Empaque…), para agrupar sus equipos; NO son las áreas de trabajo del taller.
**Proveedores:** nombre único, NIT, contacto de la empresa y contacto de la persona, condición de pago (contado / crédito con días), activar/desactivar, creación rápida desde una compra (selector con "+ Nuevo proveedor").
**Sucursales:** exactamente una principal; la principal no se desactiva; toda orden tiene sucursal (si nadie elige, la principal); no se asigna una inactiva; un taller con una sola sucursal no ve ningún selector.
**Áreas de trabajo:** nombre único, opcional en la orden; **tarifa por hora propia por tipo de equipo** (en blanco o 0 = usa la general); cambiar una tarifa no altera trabajos ya agregados.
**Alcance por sucursal:** un usuario ligado a un colaborador con sucursal solo ve y toca lo de esa sucursal (administrador y gerente nunca se limitan); clientes, equipos y catálogos se comparten entre sucursales.

## Hallazgos
1. **Error real en la API de clientes (inactivar).** `updateClient` revisa `orders.status NOT IN ('Cerrada','Cancelada','Completada')`, pero la tabla `orders` ya no tiene la columna `status` (solo `order_status_code`): cualquier intento de inactivar un cliente por la API responde error 500. Y **la pantalla ni siquiera ofrece "Inactivar"** (el formulario no tiene el campo estado): hoy un cliente con historial **no se puede retirar de ninguna manera** (borrar está bloqueado y inactivar no existe en pantalla).
2. **El NIT choca con la regla de "solo advertir".** La base de datos tiene `UNIQUE` en el NIT, pero el código trata el NIT repetido como un aviso y deja guardar: al guardar, la base lo rechaza con un mensaje genérico ("restricción única"). Además en Guatemala "CF" (consumidor final) es un NIT que **muchos clientes comparten**: con la restricción actual solo cabría uno. *(Decisión abajo.)*
3. **La pantalla y la API piden cosas distintas:** la pantalla exige correo y ciudad; la API solo nombre y teléfono. Quien use la API (app móvil, integraciones) puede crear clientes que la pantalla no dejaría.
4. **Departamentos del cliente:** editar y desactivar usan `/clients/departamentos/:id` e **ignoran a qué cliente pertenece** (cualquiera con permiso puede tocar el de otro cliente); y el mensaje al eliminar promete que los equipos "quedarán sin departamento" cuando en realidad el departamento solo se oculta y los equipos siguen apuntando a él.
5. **Revisiones de la estructura en cada petición** (`SHOW COLUMNS … LIKE 'phone2'`/`'contact'`) para columnas que ya están en el esquema oficial; texto de error técnico visible ("Ejecuta la migración 103").
6. **Normalización a medias en el servidor:** nombre, NIT y ciudad del cliente se ponen en mayúsculas en el servidor, el resto no; el proveedor no se normaliza en el servidor (solo el navegador lo pone en mayúsculas dos veces: en cada tecla y otra vez al enviar). Con el estándar §5 y una sola función en el servidor esto desaparece.
7. **Se descargan todos los clientes de una vez** (con un parámetro `?_=hora` para saltarse la caché); la paginación "50/100/Todos" solo recorta en el navegador.
8. **Etiqueta que miente (otra vez):** en Proveedores el botón dice "Eliminar" pero solo desactiva. Igual que en Usuarios de Plataforma.
9. **Un formulario dentro de otro:** `ProveedorFormModal` necesitó `stopPropagation()` porque el componente `Modal` no usa "portal" y el formulario queda anidado dentro del de la compra; la causa de fondo es el `Modal`.
10. **Alcance por sucursal repartido en 8 funciones auxiliares** (`assertOrderInScope`, `assertWarehouseInScope`, `requireOrderInScopeParam`, `bloquearSiTieneSucursalAsignada`…) más una consulta a la base por petición para saber la sucursal del usuario; y la excepción "administrador y gerente" se decide **por el nombre del rol**. En el sistema nuevo el alcance se aplica una sola vez en la capa de acceso a datos y la excepción es un permiso ("ver todas las sucursales").
11. **Moneda escrita a mano** (`Q`) en las tarifas por área, y nombres de sucursales/áreas sin normalizar en el servidor.
12. Contadores de órdenes por sucursal/área con una subconsulta por cada fila (se vuelve lenta con muchas órdenes).

## Diseño nuevo
- **Clientes:** campo `estado` (activo / inactivo) con botón "Inactivar" en pantalla; borrar solo si no tiene historia; validación única (compartida por pantalla y API); NIT con la regla que decida Luis; aviso de duplicados por correo/teléfono.
- **Departamentos del cliente:** ruta anidada que verifica el cliente; borrado lógico que pregunta por los equipos que lo usan.
- **Proveedores:** igual que hoy; botón con la palabra correcta ("Desactivar"); un solo componente de formulario con `Modal` en portal.
- **Sucursales/áreas:** igual que hoy (reglas de principal, tarifas por área), con el alcance de sucursal como parte de la capa de datos y el permiso "ver todas las sucursales" en lugar de mirar el nombre del rol; moneda tomada de la empresa.

## Decisión necesaria de Luis
**NIT de clientes:** recomiendo que sea **único, salvo "CF"** (consumidor final), que se puede repetir sin límite; y que un NIT repetido no se guarde en silencio sino que se muestre el cliente ya existente ("ese NIT ya es de ZZZ, ¿desea abrirlo?"). Alternativa: permitir repetidos con aviso.

---
# Decisión de Luis (2026-11-10): **NIT único, salvo "CF"** (consumidor final, repetible sin límite). Un NIT ya existente no se guarda en silencio: se muestra el cliente que lo tiene y se ofrece abrirlo.
