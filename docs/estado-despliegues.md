# Estado de los despliegues

Registro verificado desde afuera (respuestas HTTP reales). Actualizar en cada cambio.
Última verificación: **14/11/2026**.

| Servicio | Plataforma | Repositorio · rama | URL | Entorno | Commit verificado | Estado |
|---|---|---|---|---|---|---|
| Frontend | Vercel (proyecto `utma/sistemalegal`) | `utma-tech/sistemalegal` · `main` | https://sistemalegal-henna.vercel.app | Desarrollo UTMA | `aced05e` | **Funciona.** Sigue con `VITE_API_URL` cargada: el bundle llama directo a Render en lugar de usar el proxy |
| API (Martín) | Render `sistemalegal-api` | `martinmaine/sistemalegal` · `main` | https://sistemalegal-api.onrender.com | Oficial | `1beb0db` | Responde y la base está conectada, pero corre la **versión anterior**: sin tareas, documentos, costas, calendario, usuarios ni auditoría |
| API (UTMA) | Render `sistemalegal-utma-api` | `utma-tech/sistemalegal` · `main` | `https://sistemalegal-utma-api.onrender.com` (prevista) | Desarrollo UTMA | — | **Por crear** (Blueprint) |
| PDF (UTMA) | Render `sistemalegal-utma-pdf` | `utma-tech/sistemalegal` · `main` | prevista | Desarrollo UTMA | — | **Por crear** (Blueprint) |
| Base | Supabase `sistemalegal` | — | pooler `aws-1-us-west-2` | Compartida | — | Activa (se reanudó el 14/11). Solo datos de demostración |
| Archivos | Supabase Storage `documentos` | — | — | — | — | **Por crear** (bucket privado) |
| CI | GitHub Actions `CI` | `utma-tech/sistemalegal` | — | — | — | Workflow activo pero **nunca se ejecutó** (0 corridas): revisar Settings → Actions del repositorio |

## Qué activa cada despliegue

| Evento | Despliega |
|---|---|
| Push a `main` de `utma-tech/sistemalegal` | Vercel (producción del proyecto UTMA) y, una vez creados, `sistemalegal-utma-api` y `sistemalegal-utma-pdf` |
| Push a otra rama de UTMA | Preview de Vercel solamente |
| Push a `main` de `martinmaine/sistemalegal` | `sistemalegal-api` (entorno oficial) |

## Volver a un despliegue anterior

- **Vercel:** Deployments → el despliegue anterior → *Promote to Production*.
- **Render:** Deploys → el despliegue anterior → *Rollback*.
- **Código:** `git revert <commit>` en una rama y PR a `main` (nunca `reset` + `push --force`).

## Riesgos abiertos

- La base de Supabase la usan los dos backends (Martín y UTMA). Hoy solo tiene
  datos ficticios; si el entorno oficial pasa a tener datos reales, UTMA necesita
  un proyecto de Supabase propio.
- Supabase pausa el proyecto gratuito tras 7 días sin uso; Render duerme el
  servicio tras ~15 minutos.
