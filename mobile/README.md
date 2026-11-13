# VERI-TECH — app móvil 2.000

App nativa (Expo / React Native, Android primero) para técnicos, operadores, bodegueros, supervisores y recepción. Gerente y cliente usan la web.

## Cómo está armada
- `src/nucleo/` — TODA la lógica delicada, sin nada del teléfono (se prueba en la computadora con piezas falsas): sesión con refresco, cliente de red con tiempos límite, cola de cambios por persona y taller, sincronizador, «Descargar mi día», cambios locales, reglas del checklist, fotos, menú por permisos, fechas.
- `src/plataforma/` — las piezas reales del teléfono (SQLite, almacén seguro, archivos, cámara, avisos) y el contexto de React.
- `src/ui/` y `app/` — pantallas (expo-router).

## Reglas que no se deben romper
1. Lo pendiente y lo bajado pertenecen a UNA persona en UN taller (`Espacio`): nunca se mezclan.
2. Cada cambio se guarda en la cola con su identificador (UUID) y se envía con la cabecera `X-Id-Cliente`; el servidor no lo repite.
3. Una caída de red NUNCA cierra la sesión ni marca un cambio como error.
4. Un rechazo del servidor se muestra, no se reintenta solo.
5. La contraseña no se guarda; solo el correo (si la persona lo pide).
6. Las fotos se reducen a 1.600 px y se copian a la carpeta de la app ANTES de contar como puestas.

## Comandos
```bash
npm install
npm test          # pruebas del núcleo (jest)
npm run typecheck # tipos de todo el proyecto
npx expo start    # probar en un teléfono con Expo Go o un dev build
EXPO_PUBLIC_API_URL=https://pruebas.veritech.lat/api/taller npx expo start   # contra el sitio de pruebas (el taller se escribe en la entrada, p. ej. prueba1)
```

## Pendiente (Fase 8c)
Firma del cliente con el dedo, recepción (recibir/entregar con fotos), despachar desde la bodega, solicitar material desde el trabajo, aviso «hallazgos → trabajo», entrada por correo con elección de taller, desbloqueo con huella o PIN, compilación y publicación (Google Play), código de proyecto de Expo para los avisos.
