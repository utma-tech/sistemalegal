# Auditoría integral — SistemaLegal

**Fecha:** 23/11/2026 · **Rama revisada:** `infra/entorno-utma` (commit `10abd5b`)
**Alcance:** backend (Express + PostgreSQL), frontend (React/Vite), microservicio PDF (FastAPI), esquema y seeds, configuración de despliegue (Render, Vercel, Supabase) y CI.

**Método:** revisión de código fuente y configuración, sin ejecutar el código del proyecto ni probar los servicios desplegados. No se corrieron las pruebas ni `npm audit`. Lo que depende de la configuración real de Render, Vercel o Supabase figura como **a validar**.

---

## Resumen

La base es sólida. El proyecto ya resuelve bien lo que suele fallar en sistemas de este tipo: SQL siempre parametrizado, JWT con algoritmo fijo, refresh token opaco con hash y rotación, access token solo en memoria, validación de entrada con Zod en todos los endpoints, subida de archivos validada por magic bytes y TLS verificado contra la base.

Los problemas que encontré están en los **bordes del despliegue** y en una **diferencia entre el modelo de permisos documentado y el que se aplica de verdad**.

| # | Hallazgo | Prioridad |
|---|----------|-----------|
| 1 | Administrador de demostración con contraseña publicada en el entorno desplegado | **Alta** — script listo, falta correrlo |
| 2 | El límite de intentos de login se evita llamando directo a Render con `X-Forwarded-For` | **Media** — corregido |
| 3 | El rol Empleado no está limitado a sus causas asignadas | **Media** — corregido |
| 4 | El CORS de previews acepta proyectos de Vercel de terceros | **Media** (latente) — corregido, falta configurar |
| 5 | Rotación del refresh token no atómica | Baja — corregido |
| 6 | `/health` expone el error de la base sin autenticación | Baja — corregido |
| 7 | Sin cabeceras de seguridad (CSP, frame-ancestors, HSTS) | Baja — corregido |
| 8–10 | RLS de Supabase, token del servicio PDF, base compartida con la API de Martín | 8 y 9 corregidos en código; 10 a validar |

---

## Hallazgos de seguridad

### 1. Administrador de demostración con contraseña publicada — Alta

**Dónde:** `database/seed/002_datos_demo.sql:37-51`, `README.md:154`, `docs/despliegue.md:68`, `docs/estado-despliegues.md:12,47`.

El seed de demostración crea `admin@estudiodemo.test` con rol ADMIN y la contraseña `Demo1234!`, publicada en el README. `docs/estado-despliegues.md` confirma que ese seed está aplicado en la base de Supabase que usa https://sistemalegal-henna.vercel.app.

**Impacto:** cualquiera que lea el repositorio entra como Administrador al entorno público. Puede leer y modificar todo, crear usuarios y restablecer contraseñas ajenas. Hoy los datos son de demostración, pero la misma base la comparte el servicio de Martín, y basta con que alguien cargue un caso real «para probar» para que quede expuesto.

**Corrección mínima:**
- En el entorno desplegado: desactivar o borrar los usuarios `*@estudiodemo.test` después de crear un administrador propio desde Usuarios.
- Si hace falta un entorno de demo abierto, que use una base separada y sin datos reales, y que en `docs/estado-despliegues.md` figure como «público».

### 2. Se puede evitar el límite de intentos de login — Media

**Dónde:** `backend/src/app.ts:35`, `render.yaml` (`SALTOS_PROXY: '2'`), `backend/src/modulos/auth/rutas.ts:18-30`.

Express confía en 2 saltos de proxy porque el tráfico normal pasa por Vercel → Render. Pero la API también se puede llamar **directo** en `https://sistemalegal-utma-api.onrender.com`, y ahí hay un solo proxy. Un atacante que mande `X-Forwarded-For: <ip inventada>` obtiene `X-Forwarded-For: <inventada>, <ip real>`. Con `trust proxy = 2`, `req.ip` pasa a ser la IP inventada.

**Impacto:**
- El limitador de login (10 intentos por IP) deja de servir: rotando la cabecera, la fuerza bruta de contraseñas no tiene tope.
- La IP que se guarda en `auditoria.ip` y en `refresh_token.ip` se puede falsificar.

**Corrección mínima:** sumar un segundo limitador por **cuenta** (clave = email normalizado) que cuente los fallos, porque esa clave no se falsifica con cabeceras. Como alternativa, o además, que la API rechace las peticiones que no lleguen por Vercel. Para eso hace falta un secreto compartido en una cabecera, y como los rewrites de `vercel.json` no agregan cabeceras de petición, requiere una función o middleware de Vercel.
**Prueba de regresión:** 11 logins fallidos contra el mismo email, cada uno con distinto `X-Forwarded-For`, tienen que terminar en 429.

### 3. El rol Empleado ve y edita todas las causas — Media (decisión de producto)

**Dónde:** `database/seed/001_catalogos.sql:228` define el rol Empleado como «Opera sobre las causas en las que está asignado». `001_catalogos.sql:264-271` le da `causa.ver/editar`, `documento.*`, `costa.ver/exportar` y `persona.*` sin ninguna restricción. En el backend, `requierePermiso` (`middlewares/autenticacion.ts:34`) controla solo el permiso, y ningún listado ni detalle filtra por `profesional_causa`.

**Impacto:** un Empleado puede leer, editar y exportar cualquier expediente, sus documentos y sus costas, aunque no esté asignado. Hay además una fuga menor: al subir un archivo duplicado, la respuesta muestra la carátula de la otra causa (`documentos/rutas.ts:148`).

**Qué decidir:**
- Si la intención es que todo el estudio vea todo, corregir la descripción del rol y no hay nada más que hacer.
- Si no, hace falta un control por objeto. Por ejemplo, una función `exigirAccesoACausa(sesion, causaId)` que deje pasar a ADMIN y JEFE_ESTUDIO y exija asignación vigente a EMPLEADO, aplicada en `causas`, `plazos`, `documentos`, `costas`, `tareas` y en la búsqueda de texto de documentos. Los listados también tendrían que filtrar.

### 4. El CORS de previews acepta proyectos de Vercel ajenos — Media (latente)

**Dónde:** `backend/src/config.ts:168-186` junto con `credentials: true` en `app.ts:53`.

`esPreviewDeVercel` acepta cualquier `https://sistemalegal-<lo-que-sea>.vercel.app`. Cualquier persona puede crear un proyecto llamado `sistemalegal-x` en su propia cuenta de Vercel y obtener un origen que la API autoriza, con credenciales.

**Por qué hoy no se puede explotar:** la cookie de refresh es `SameSite=Lax` y `vercel.app` está en la Public Suffix List, así que el navegador no la manda desde el origen atacante. El access token vive en memoria.
**Cuándo se vuelve grave:** si alguna vez se configura `COOKIE_SAMESITE=none`, como prevé el código, ese origen podría llamar a `/api/auth/refrescar` y leer el access token de la respuesta, lo que equivale a robar la sesión.

**Corrección mínima:** exigir también el sufijo del equipo (`subdominio.endsWith('-<slug-del-equipo>')`), que solo el equipo puede generar. Otra opción es desactivar el comodín de previews cuando `NODE_ENV=production` y listar los orígenes en `CORS_ORIGIN`. Conviene agregar un caso a `tests/cors.test.ts`.

### 5. La rotación del refresh token no es atómica — Baja

**Dónde:** `backend/src/modulos/auth/servicio.ts:68-97`.

El flujo es buscar la fila, verificar que no esté revocada y recién después revocarla. Si llegan dos `POST /refrescar` simultáneos con el mismo token, los dos pasan la verificación y emiten dos sesiones válidas, sin que se detecte la reutilización. Esto le quita fuerza a la protección contra tokens robados.

**Corrección:** revocar de forma condicional y atómica, con `UPDATE refresh_token SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL AND expira_en > now() RETURNING usuario_id`. Si no devuelve fila, tratarlo como token inválido o reutilizado.

### 6. `/health` expone el error de la base — Baja

**Dónde:** `backend/src/app.ts:68-81`.

`detalleBase` devuelve sin autenticación el mensaje de error de `pg`, también en producción. Ese mensaje puede incluir el host del pooler, el usuario o detalles de TLS. El manejador de errores general ya oculta estos datos en producción, pero `/health` no sigue esa regla.
**Corrección:** omitir `detalleBase` cuando `config.entorno === 'production'` y dejar el detalle solo en el log.

### 7. Sin cabeceras de seguridad HTTP — Baja

Ni `frontend/vercel.json` ni la API configuran `Content-Security-Policy`, `frame-ancestors` / `X-Frame-Options`, `Strict-Transport-Security` ni `Referrer-Policy`. No encontré ningún XSS (no hay `dangerouslySetInnerHTML` ni `innerHTML`), así que esto es defensa en profundidad. Igual conviene tenerlo en un sistema con datos de la Ley 25.326.
**Corrección:** un bloque `headers` en `vercel.json` con CSP `default-src 'self'`, `frame-ancestors 'none'`, HSTS y `Referrer-Policy: strict-origin-when-cross-origin`.

---

## A validar (dependen de la configuración real)

8. **RLS en Supabase.** Ninguna migración habilita Row Level Security. Si la Data API (PostgREST) del proyecto está activa y los roles `anon` / `authenticated` tienen permisos sobre `public`, cualquiera con la anon key podría leer o escribir las tablas directamente. Hay que revisarlo en Supabase, en Database → Advisors.
   Arreglo sugerido: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` en todas las tablas, sin políticas, o bien `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`. El backend se conecta como dueño de las tablas, así que no se ve afectado.
9. **Token del servicio PDF.** Si `PDF_SERVICE_TOKEN` no está definido, `pdf-service/main.py:38` deja `/extraer` abierto a todo internet. `docs/estado-despliegues.md` dice que se usa el token, así que verificarlo en Render alcanza. De paso: el servicio lee el cuerpo entero antes de chequear el tamaño y no tiene un tiempo máximo por PDF, de modo que un PDF patológico puede trabar el worker.
10. **Base compartida con la API de Martín (`1beb0db`).** Esa versión anterior accede a los mismos datos, y sus controles no se revisaron acá. Si las dos APIs comparten `JWT_SECRET`, los tokens de una sirven en la otra. Conviene confirmarlo y, mejor todavía, separar las bases.

## Informativo

- Un cambio de rol o una baja tarda hasta 15 minutos en reflejarse en el access token. Es una decisión documentada (`auth/tokens.ts:10-14`) y la baja corta el refresh en el acto.
- Solo `/api/auth/login` tiene límite de intentos. `POST /api/cuenta/password` permite probar la contraseña actual sin tope, aunque exige un access token válido.

---

## Calidad, pruebas y operación

| Área | Estado | Recomendación |
|------|--------|---------------|
| Pruebas backend | 13 archivos, unos 170 casos, con integración contra PostgreSQL en CI | Agregar casos de los hallazgos 2, 4 y 5 |
| Pruebas frontend | **Ninguna** | Como mínimo, Vitest + Testing Library para `servicios/api.ts` (renovación de sesión) y `RutaProtegida` |
| Pruebas PDF | 6 casos con pytest en CI | OK |
| Dependencias | Versiones con `^` y lockfiles; Python fijado | Sumar Dependabot o `npm audit --omit=dev` en CI |
| Contenedores | El servicio PDF corre sin root; la etapa `produccion` del backend no declara `USER` | `USER node` en `backend/Dockerfile` (Render usa runtime nativo, así que solo afecta a Docker) |
| Tipado | Typecheck de back y front en CI | OK |
| Errores | Manejador central que oculta detalles en producción | OK (salvo `/health`, hallazgo 6) |

## Lo que ya está bien hecho

- SQL 100 % parametrizado. Los `ORDER BY` dinámicos salen de una lista blanca (`COLUMNAS_ORDEN`).
- JWT con `algorithms: ['HS256']` e `issuer` fijos. El servicio no arranca en producción sin un secreto de 32 caracteres o más.
- Refresh token opaco de 256 bits, guardado como SHA-256, rotado y con detección de reutilización. La cookie es `httpOnly`, `Secure`, `SameSite=Lax` y con `path=/api/auth`.
- Login con mensaje único y hash señuelo para no revelar qué correos existen. bcrypt con costo 12.
- Bajas y cambios de contraseña revocan todas las sesiones, y se impide quedarse sin administradores.
- Subidas: tipo detectado por contenido, nombre saneado, clave de almacenamiento sin datos del usuario, protección contra path traversal y descarga con `attachment` + `nosniff`.
- Exportación CSV protegida contra inyección de fórmulas (`costas/rutas.ts:176`).
- Auditoría que filtra contraseñas y tokens antes de guardar.
- TLS contra Supabase con la CA verificada, sin `rejectUnauthorized: false`.
- La clave `service_role` de Storage nunca sale del backend.

## Correcciones aplicadas (23/11/2026)

**Segunda ronda.** Los cambios de código no quedan activos hasta que lleguen a `main`, porque Render y Vercel despliegan desde esa rama. Lo que además requiere tocar los paneles está marcado **(panel)**.

- **Hallazgo 1 (panel):** `database/mantenimiento/desactivar-usuarios-demo.sql` desactiva los usuarios `*@estudiodemo.test` y corta sus sesiones. Si no queda otro Administrador activo, se niega a correr. Antes hay que crear uno propio desde Usuarios, con la sesión del admin de demostración (`npm run crear-admin` se niega mientras haya un Administrador activo). Probado en una base descartable, con y sin admin propio.
- **Hallazgo 2:** segundo limitador por cuenta (`INTENTOS_LOGIN_POR_CUENTA`, 10 por defecto) en `backend/src/modulos/auth/rutas.ts`, que actúa sobre el correo ya normalizado. Prueba: 11 intentos con la IP rotada terminan en 429. La IP que guarda la auditoría sigue siendo falsificable si se llama a Render directo.
- **Hallazgo 3:** el control de alcance está en `backend/src/comun/alcance.ts`. Admin y Jefe ven todo; cualquier otro rol ve solo las causas en las que está asignado, y un rol nuevo queda restringido por defecto. El control se aplica en tres lugares:
  - Un middleware sobre todo `/api/causas/:id/*`.
  - `router.param('id')` en plazos, costas, documentos y tareas.
  - Filtros en los listados (causas, plazos, costas y su exportación, tareas, búsqueda en documentos, alertas, panel y causas de una persona).

  Lo que queda fuera del alcance responde 404. Las tareas sin expediente, las delegadas al usuario y los plazos de los que es responsable también son visibles. Las personas (agenda de clientes) siguen siendo comunes a todo el estudio. Pruebas: `tests/alcance.test.ts`, con 6 casos.
- **Hallazgo 4 (panel):** `CORS_SUFIJO_EQUIPO` exige que los previews terminen en `-<slug-del-equipo>`. **Hasta que se defina en Render, el comportamiento es el de antes.** Al definirla, hay que agregar `https://sistemalegal-henna.vercel.app` a `CORS_ORIGIN`.
- **Hallazgo 5:** la rotación del refresh token usa un `UPDATE … WHERE revocado_en IS NULL` condicional. De varios refrescos simultáneos, solo uno obtiene sesión.
- **Hallazgo 6:** `/health` omite `detalleBase` en producción.
- **Hallazgo 7:** `frontend/vercel.json` envía CSP (`default-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options`, HSTS, `Referrer-Policy`, `Permissions-Policy` y `nosniff`. El build no tiene scripts ni estilos inline. Si alguna vez se usa `VITE_API_URL` apuntando a otro dominio, ese dominio tiene que sumarse a `connect-src`.
- **Punto 8 (panel):** migración `013_rls_y_roles_publicos.sql`, también agregada a `schema.sql`. Activa RLS sin políticas en todas las tablas y quita los permisos de `anon` y `authenticated`. Se verificó en una base descartable con un rol `anon` creado como lo crea Supabase: el dueño de las tablas sigue leyendo y `anon` recibe *permission denied*. Hay que aplicarla en Supabase.
- **Punto 9:** el servicio PDF ahora se niega a extraer sin `PDF_SERVICE_TOKEN`, salvo con `PDF_SIN_TOKEN=1`, que solo pone docker compose. Además corta el cuerpo mientras lo lee si supera el tope, procesa en un hilo aparte y tiene un tiempo máximo (`SEGUNDOS_MAXIMO_EXTRACCION`, 60 s).
- **Informativo:** `POST /api/cuenta/password` admite como máximo 5 intentos fallidos por usuario en cada ventana.
- **Calidad:**
  - `backend/Dockerfile` corre como `USER node`.
  - Hay pruebas del frontend con Vitest en `src/servicios/api.test.ts` (renovación de sesión, refresco único, errores), con 8 casos.
  - La CI corre `npm audit --omit=dev --audit-level=high` y las pruebas del frontend.
  - Se agregó `.github/dependabot.yml`.
- **Dependencias:**
  - Se actualizó `body-parser` a 2.4.0, porque la 2.3.0 tenía un aviso alto de DoS (GHSA-27r3-jxmh-p828) y llegaba a producción.
  - `vite` pasó a 6.4.6.
  - `vitest` pasó a 4.1 en los dos paquetes, porque la 3.x tenía avisos críticos.
  - `npm audit` da 0 vulnerabilidades en backend y frontend.

**Verificación:** typecheck y build en backend y frontend. Pruebas: backend 183 (contra la base local), frontend 8 y PDF 8.

**Sigue pendiente:**
- Punto 10: separar la base de la API de Martín y no compartir `JWT_SECRET`.
- Ejecutar en el entorno real lo marcado **(panel)**.
