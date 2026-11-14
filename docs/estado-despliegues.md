# Estado de los despliegues

Registro verificado desde afuera (respuestas HTTP reales y prueba en el navegador).
Última verificación: **14/11/2026**, commit `073a9f1`.

| Servicio | Plataforma | Repositorio · rama | URL | Entorno | Commit | Estado |
|---|---|---|---|---|---|---|
| Frontend | Vercel (proyecto `utma/sistemalegal`) | `utma-tech/sistemalegal` · `main` | https://sistemalegal-henna.vercel.app | Desarrollo UTMA | `073a9f1` | **Funciona.** Usa el proxy de `/api` (sin `VITE_API_URL`) |
| API (UTMA) | Render `sistemalegal-utma-api` | `utma-tech/sistemalegal` · `main`, auto-deploy | https://sistemalegal-utma-api.onrender.com | Desarrollo UTMA | `073a9f1` | **Funciona.** `/health` ok, base conectada |
| PDF (UTMA) | Render `sistemalegal-utma-pdf` | `utma-tech/sistemalegal` · `main`, auto-deploy | https://sistemalegal-utma-pdf.onrender.com | Desarrollo UTMA | `073a9f1` | **Funciona.** Extrae texto con el token compartido |
| API (Martín) | Render `sistemalegal-api` | `martinmaine/sistemalegal` · `main` | https://sistemalegal-api.onrender.com | Oficial | `1beb0db` | Sin tocar. Corre la versión anterior; ya no la usa el frontend de UTMA |
| Base | Supabase `sistemalegal` | — | pooler `aws-1-us-west-2`, puerto 6543 | Compartida con el servicio de Martín | — | Activa. Solo datos de demostración |
| Archivos | Supabase Storage, bucket privado `documentos` | — | — | — | — | **Funciona** (subida verificada) |
| CI | GitHub Actions `CI` | `utma-tech/sistemalegal` | — | — | `073a9f1` | **Pasa** en `main` (backend con PostgreSQL, frontend, PDF) |

## Verificación funcional en producción (14/11/2026)

Hecha en el navegador sobre https://sistemalegal-henna.vercel.app con el usuario
de demostración (la sesión la inició una persona):

- Recarga de la página con sesión abierta: la sesión se conserva (cookie de primera parte vía proxy).
- Pantallas Tareas, Calendario judicial, Honorarios y costas, Usuarios y Auditoría: cargan datos del backend de UTMA.
- Subida de un PDF a un expediente: se guarda en Supabase Storage, el servicio de PDF extrae el texto y la búsqueda en Documentos lo encuentra («intimacion»).
- **No verificado:** descarga del archivo desde la interfaz, alta/edición de registros en producción (solo cubiertos por las pruebas automáticas), campana de avisos.

## Qué activa cada despliegue

| Evento | Despliega |
|---|---|
| Push a `main` de `utma-tech/sistemalegal` | Vercel (producción) y `sistemalegal-utma-api` / `sistemalegal-utma-pdf` |
| Push a otra rama de UTMA | Preview de Vercel solamente (Render no) |
| Push a `main` de `martinmaine/sistemalegal` | `sistemalegal-api` (entorno oficial) |

## Volver a un despliegue anterior

- **Vercel:** Deployments → el despliegue anterior → *Promote to Production* (pide verificar identidad por correo).
- **Render:** Deploys → el despliegue anterior → *Rollback*.
- **Código:** `git revert <commit>` en una rama y PR a `main` (nunca `reset` + `push --force`).

## Riesgos abiertos

- La base de Supabase la usan los dos backends (Martín y UTMA). Hoy solo tiene
  datos ficticios; si el entorno oficial pasa a tener datos reales, UTMA necesita
  un proyecto de Supabase propio.
- Supabase pausa el proyecto gratuito tras 7 días sin uso; Render duerme los
  servicios tras ~15 minutos (la primera visita tarda ~50 s).
- Los usuarios de demostración tienen una contraseña publicada en el README: no
  usar este entorno con datos reales sin crear usuarios propios (`npm run crear-admin`).
