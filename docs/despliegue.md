# Despliegue

Cómo se levanta el sistema, en local y en producción. Las decisiones y su
justificación están en [`arquitectura.md`](arquitectura.md), sección 6; acá están
los pasos.

---

## 1. Panorama

```
Navegador ──▶ Vercel  (frontend/: la SPA, y /api/* reenviado a Render)
                 │
                 └─▶ API          Render   sistemalegal-api  (backend/, render.yaml)
                        │
                        ├─▶ PostgreSQL       Supabase  (esquema y seeds aplicados con psql)
                        ├─▶ Archivos         Supabase Storage, bucket privado «documentos»
                        └─▶ Extracción PDF   Render   sistemalegal-pdf  (pdf-service/, Python)
```

El navegador **solo habla con el dominio de Vercel**: `frontend/vercel.json`
reenvía `/api/*` a Render. Así la cookie de sesión es de primera parte y ningún
navegador la descarta por ser de terceros (Safari lo hace por defecto, Chrome en
incógnito también). Sin este proxy, el usuario quedaría afuera al recargar.

Servicios independientes, cada uno en la capa gratuita de su plataforma.
El frontend y el backend se redesplegan solos con cada push a `main`; la base se
migra a mano, de forma deliberada: una migración no debe correr por accidente.

---

## 2. Entorno local

Requisitos: Docker y Docker Compose. No hace falta instalar Node ni PostgreSQL.

```bash
cp .env.example .env
docker compose up
```

Levanta cuatro contenedores:

| Servicio | URL | Qué es |
|---|---|---|
| `frontend` | http://localhost:5173 | SPA con Vite en modo desarrollo |
| `backend` | http://localhost:4000 | API REST con recarga automática |
| `pdf` | http://localhost:8000 | Microservicio de extracción de texto de PDF (Python + FastAPI + pdfplumber) |
| `db` | `localhost:5432` | PostgreSQL 18 con el esquema y los datos ficticios ya aplicados |

Los archivos subidos quedan en el volumen `archivos` del backend.

La base se inicializa sola la primera vez:
[`database/docker/10-esquema-y-seeds.sh`](../database/docker/10-esquema-y-seeds.sh)
aplica `schema.sql` y los dos seeds. El backend espera a que el `healthcheck`
confirme que la tabla `causa` existe, así que no arranca contra una base a medio
inicializar.

Para empezar de cero: `docker compose down -v` (la `-v` borra el volumen y
fuerza a reaplicar el esquema).

### Comprobar que anda

```bash
curl http://localhost:4000/health
curl http://localhost:8000/health
```

Y abrir http://localhost:5173 con un usuario de demostración (`admin@estudiodemo.test`,
contraseña `Demo1234!`).

---

## 3. Producción

El orden importa: Render necesita la cadena de Supabase, y Vercel necesita la URL de
Render. El último paso vuelve sobre Render porque CORS necesita el dominio de
Vercel, que todavía no existe cuando se crea la API.

### 3.1 Supabase — base de datos

> **Lo más importante de esta página.** Supabase muestra por defecto la
> *conexión directa* (`db.<ref>.supabase.co`), y esa **no sirve para Render**: es
> IPv6, y Render no tiene salida IPv6. Hay que usar el **pooler compartido**
> (Supavisor), que es IPv4 en todos los planes. Si la API en Render dice
> `sin-conexion` con las credenciales correctas, el problema es este.

Y no es una cadena sino dos, porque se usan en modos distintos:

| Para qué | Modo | Puerto |
|---|---|---|
| Aplicar el esquema con `psql` | sesión | `5432` |
| La API corriendo en Render | transacción | `6543` |

El modo transacción no acompaña bien al DDL de las migraciones; el modo sesión
sí, pero el recomendado para un servicio web es el de transacción. Por eso cada
tarea usa el suyo.

1. Crear cuenta en [supabase.com](https://supabase.com) (conviene entrar con GitHub).
2. **New project**: nombre `sistemalegal`, región **South America (São Paulo)**, la
   más cercana a Córdoba. Guardar la contraseña de la base: se muestra una sola vez.
3. Ir a **Connect** (arriba, junto al nombre del proyecto) y copiar las cadenas de
   **Session pooler** y **Transaction pooler**. El host se copia del panel tal cual
   (`aws-X-REGION.pooler.supabase.com`), no se arma a mano, y el usuario viene con
   la forma `postgres.<ref-del-proyecto>`.
4. Aplicar el esquema y los seeds **con la cadena de modo sesión**. Si no tenés
   `psql` instalado, el cliente sale de la imagen de Docker, sin instalar nada:

   ```bash
   # Modo sesion, puerto 5432: la de las migraciones.
   export DATABASE_URL='postgresql://postgres.abcdefgh:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require'

   ./database/aplicar-remoto.sh
   ```

   El script aplica `schema.sql` y los dos seeds en orden, con `ON_ERROR_STOP=1`
   —sin eso `psql` sigue después de un error y el esquema queda a medias
   pareciendo que funcionó—, y al final cuenta las filas para que se vea que
   quedó bien. Si le pasás la cadena equivocada —la de modo transacción o la
   conexión directa— se planta y te lo dice, en lugar de fallar a mitad de camino.

   La cadena viaja al contenedor por variable de entorno, así que no queda en la
   línea de comandos ni en el historial del shell.

5. Verificar: el propio script cuenta causas, fueros y estados al terminar. Si
   esos números dan cero, los seeds no entraron.

> Las extensiones son el único punto donde Supabase difiere de un PostgreSQL
> común: las instala en el esquema `extensions` y no en `public`. El esquema ya
> lo contempla —`fn_sin_acentos()` declara su propio `search_path` nombrando los
> dos—, así que no hay nada que ajustar. El detalle está en
> [`database/README.md`](../database/README.md).

### 3.2 Render — API

1. Crear cuenta en [render.com](https://render.com) con GitHub.
2. **New > Blueprint**, elegir el repositorio. Render lee
   [`render.yaml`](../render.yaml) y propone **dos** servicios: `sistemalegal-api`
   (Node) y `sistemalegal-pdf` (Python), con el *root directory*, el *build command*
   y el *health check* ya resueltos.
3. Cargar las variables que el blueprint marca como `sync: false`:

   | Servicio | Variable | Valor |
   |---|---|---|
   | api | `DATABASE_URL` | la cadena del **pooler en modo transacción** (puerto `6543`), con `sslmode=require` |
   | api | `CORS_ORIGIN` | el dominio de Vercel (`https://sistemalegal.vercel.app`); se confirma en el paso 3.4 |
   | api | `JWT_SECRET` | un secreto aleatorio de al menos 32 caracteres (comando abajo). **Sin él el servicio no arranca.** |
   | api | `PDF_SERVICE_URL` | la URL pública de `sistemalegal-pdf`, sin barra final |
   | api y pdf | `PDF_SERVICE_TOKEN` | **el mismo** secreto aleatorio en los dos servicios |
   | api | `SUPABASE_URL` | `https://<ref>.supabase.co` (Settings → API) |
   | api | `SUPABASE_SERVICE_KEY` | la clave `service_role` (Settings → API). Solo vive en Render: nunca en el frontend. |

   `SALTOS_PROXY=2` y `COOKIE_SAMESITE=lax` ya vienen en el blueprint: son los
   valores correctos detrás del proxy de Vercel.

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Esperar el despliegue y comprobar `https://sistemalegal-api.onrender.com/health`.
   Tiene que responder `"base": "conectada"`. Si dice `sin-conexion`, el campo
   `detalleBase` lo aclara. El error más probable es haber pegado la conexión
   directa en vez de la del pooler: ahí el detalle habla de red o de host
   inalcanzable, no de credenciales.

### 3.2 bis Supabase Storage — documentos

El disco de Render gratis se borra en cada despliegue, así que los archivos van a
Supabase Storage. En el panel del proyecto: **Storage → New bucket**, nombre
`documentos`, **privado** (sin acceso público). No hace falta ninguna política: el
backend entra con la clave `service_role` y es el único que lee y escribe; el
navegador descarga siempre a través de la API, que verifica el permiso
`documento.ver`.

Si `SUPABASE_URL` o `SUPABASE_SERVICE_KEY` faltan, el backend guarda en disco
local: sirve para desarrollo, no para Render.

### 3.3 Vercel — SPA

1. Crear cuenta en [vercel.com](https://vercel.com) con GitHub.
2. **Add New > Project**, importar el repositorio.
3. **Root Directory: `frontend`.** Es el paso que más se olvida en un monorepo;
   sin eso el build falla porque no encuentra el `package.json`.
4. El framework lo detecta solo (Vite). **No** hace falta `VITE_API_URL`: en
   producción la SPA le habla a su propio dominio y
   [`frontend/vercel.json`](../frontend/vercel.json) reenvía `/api/*` a Render.
   Si el servicio de Render quedó con otro nombre que `sistemalegal-api`, hay que
   corregir la URL de destino en ese archivo (Vercel no admite variables ahí).
   Si se define `VITE_API_URL`, se saltea el proxy y vuelve el problema de la cookie.

5. **Deploy**, y anotar el dominio que queda (`https://sistemalegal.vercel.app`).

### 3.4 Cerrar el círculo de CORS

Volver a Render y confirmar que `CORS_ORIGIN` tiene el dominio de Vercel del paso
anterior (el proxy reenvía la cabecera `Origin` del navegador). Render redespliega solo.

Los *previews* de Vercel cambian de dominio en cada push, así que no se pueden
poner en una lista fija: el backend los autoriza por prefijo del proyecto con
`CORS_PREFIJO_PREVIEW` (ver [`backend/src/config.ts`](../backend/src/config.ts)).
Se autoriza `sistemalegal*.vercel.app`, no cualquier `*.vercel.app`.

### 3.5 Datos: demostración o instalación real

- **Para la entrega y la defensa**, `aplicar-remoto.sh` carga los datos ficticios y
  los usuarios de demostración (`Demo1234!`). Es lo que conviene mostrar.
- **Para un estudio real**, se aplica solo `schema.sql` y `001_catalogos.sql`
  —nunca `002_datos_demo.sql`— y el primer Administrador se crea desde la Shell
  del servicio en Render:

  ```bash
  ADMIN_EMAIL=... ADMIN_NOMBRE=... ADMIN_APELLIDO=... ADMIN_PASSWORD=... node dist/scripts/crear-admin.js
  ```

  El script se niega si ya hay un administrador activo. El resto de los usuarios
  se crean desde **Administración → Usuarios y permisos**.

---

## 4. Variables de entorno

Ninguna vive en el repositorio. [`.env.example`](../.env.example) documenta todas
sin valores reales.

| Variable | Servicio | Para qué |
|---|---|---|
| `DATABASE_URL` | backend | Conexión a PostgreSQL. En producción, el pooler de Supabase en modo transacción, con TLS. |
| `PORT` | backend | Puerto de escucha. Render lo inyecta solo. |
| `CORS_ORIGIN` | backend | Dominios autorizados, separados por coma. |
| `CORS_PREFIJO_PREVIEW` | backend | Prefijo para autorizar los previews de Vercel. |
| `LIMITE_LISTADOS` | backend | Tope de filas por listado. |
| `VITE_API_URL` | frontend | URL de la API vista desde el navegador. |
| `JWT_SECRET` | backend | **Obligatoria en producción.** Firma los tokens de acceso; el servicio no arranca si falta o tiene menos de 32 caracteres. |
| `MINUTOS_ACCESS_TOKEN` | backend | Vida del token de acceso. Por defecto 15. |
| `DIAS_REFRESH_TOKEN` | backend | Vida de la sesión renovable. Por defecto 7. |
| `INTENTOS_LOGIN` | backend | Intentos de inicio de sesión por ventana. Por defecto 10. |
| `MINUTOS_VENTANA_LOGIN` | backend | Ventana del límite de intentos. Por defecto 15. |
| `SALTOS_PROXY` | backend | Proxies delante de Express: 1 en Render solo, 2 con el proxy de Vercel. Por defecto 1. |
| `COOKIE_SAMESITE` | backend | `lax` detrás del proxy de Vercel (por defecto); `none` solo si la API se consume desde otro sitio. |
| `PDF_SERVICE_URL` | backend | URL del microservicio de PDF. Sin ella los PDF se guardan y el texto queda pendiente. |
| `PDF_SERVICE_TOKEN` | backend y pdf | Token compartido entre la API y el microservicio. |
| `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `SUPABASE_BUCKET` | backend | Almacenamiento de documentos. Sin ellas, disco local (`ALMACENAMIENTO_DIR`). |
| `MEGAS_MAXIMO_ARCHIVO` | backend y pdf | Tamaño máximo de un archivo. Por defecto 10. |
| `CLAUDE_API_KEY` | backend | Reservada: entra con el módulo de IA. Opcional. |

---

## 5. Verificación de punta a punta

```bash
curl https://sistemalegal.vercel.app/health           # por el proxy: estado ok, base conectada
curl https://sistemalegal-pdf.onrender.com/health      # microservicio de PDF
```

Y abrir el dominio de Vercel, entrar, **recargar la página** (si la sesión
sobrevive, la cookie funciona), subir un PDF a un expediente y buscar una palabra
suya en **Documentos**. Si la API responde pero la SPA muestra un error de red,
es CORS: revisar el paso 3.4.

---

## 6. Problemas conocidos de la capa gratuita

| Síntoma | Causa | Qué hacer |
|---|---|---|
| La primera visita tarda ~50 s | Render duerme el servicio tras ~15 min sin tráfico | La SPA avisa que la API está despertando. Antes de una demostración, abrir `/health` para despertarla. |
| `base: sin-conexion` tras una semana sin uso | Supabase **pausa** los proyectos gratuitos tras 7 días de inactividad | No se despierta solo: hay que reactivarlo a mano desde el panel. Antes de la defensa, entrar al proyecto con anticipación. |
| `base: sin-conexion` con credenciales correctas | Se usó la conexión directa, que es IPv6, y Render no tiene salida IPv6 | Usar la cadena del pooler compartido (paso 3.1). |
| El build de Vercel no encuentra `package.json` | Falta *Root Directory* `frontend` | Paso 3.3.3. |
| Error de red solo desde el dominio de Vercel | `CORS_ORIGIN` sin el dominio de producción | Paso 3.4. |
| Al recargar la página vuelve al login | La SPA le habla directo a Render (se definió `VITE_API_URL`) y el navegador bloqueó la cookie de terceros | Quitar `VITE_API_URL` en Vercel y redesplegar: el proxy de `vercel.json` hace el resto. |
| Un PDF queda en «Texto pendiente» | Falta `PDF_SERVICE_URL`, o el servicio de PDF estaba dormido | Configurar la variable y usar «Reintentar la extracción» en el documento. |
| «El archivo no está disponible en el almacenamiento» | Se subió con disco local y Render lo borró al redesplegar | Configurar Supabase Storage (3.2 bis) y volver a cargar el archivo. |
| `self-signed certificate in certificate chain` | Falta la CA de Supabase, o el `sslmode` de la URL pisó la configuración de TLS | La CA está en `backend/certs/supabase-ca.crt` y el código quita el `sslmode` de la cadena. Si cambiaste eso, revisá `backend/src/db.ts`. |
| El esquema quedó a medias | Se corrió `psql` sin `ON_ERROR_STOP=1` | Borrar y recrear el proyecto en Supabase, y reaplicar. |
| El DDL falla raro al migrar | Se usó el pooler en modo transacción para las migraciones | Usar la cadena de modo sesión, puerto `5432`. |

---

## 7. Para la defensa oral

La arquitectura previó dos caminos, y el segundo existe justamente como
respaldo:

1. **El despliegue**, accesible desde cualquier navegador. Conviene despertar la
   API unos minutos antes y, si pasó más de una semana, revisar que el proyecto de
   Supabase no esté pausado.
2. **`docker compose up`**, que no depende de la conectividad ni de que los
   servicios gratuitos estén despiertos.
