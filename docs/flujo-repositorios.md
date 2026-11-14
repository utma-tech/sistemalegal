# Flujo de repositorios

| Remoto local | Repositorio | Rol |
|---|---|---|
| `origin` | `utma-tech/sistemalegal` | **Fuente de verdad.** Todo desarrollo nuevo va acá. |
| `martin` | `martinmaine/sistemalegal` | Repositorio oficial de destino. No se toca hasta la transferencia final. |

Al 14/11/2026, `martin/main` (`1beb0db`) es **ancestro** de `origin/main`: Martín no
tiene ningún commit que UTMA no tenga. La transferencia futura es, por lo tanto, un
avance sin conflictos mientras nadie suba cambios a Martín.

## Trabajo diario en UTMA

1. Rama desde `main`: `git switch -c tipo/descripcion origin/main`.
2. Cambios, `npm run typecheck`, `npm run build` y `npm test` en `backend/`;
   `typecheck` y `build` en `frontend/`; `python -m pytest -q` en `pdf-service/`.
3. `git push -u origin <rama>` y pull request contra `main`. CI corre los tres
   bloques (backend con PostgreSQL, frontend y PDF).
4. Merge a `main` → despliegue automático del entorno UTMA (ver
   [`estado-despliegues.md`](estado-despliegues.md)).

**Autor de los commits.** El plan gratuito de Vercel bloquea el despliegue de un
commit cuyo autor no es el dueño de la cuenta. Este clon tiene configurado en
`git config --local` el usuario `utma-tech` con su correo `noreply` de GitHub. Si
se trabaja desde otra máquina, configurarlo igual antes del primer commit:

```bash
git config --local user.name "utma-tech"
```

```bash
git config --local user.email "321501138+utma-tech@users.noreply.github.com"
```

Nunca `git push --force` sobre `main` ni sobre ramas compartidas.

## Transferencia final a Martín (NO ejecutar hasta que se pida)

1. `git fetch --all`.
2. Verificar si Martín recibió commits propios:
   `git log --oneline origin/main..martin/main`. Si la lista está vacía, no hay
   nada que preservar; si no, revisar cada uno y llevar a UTMA lo válido antes de
   seguir.
3. Rama de integración desde `martin/main`:
   `git switch -c integracion/utma martin/main` y `git merge --no-ff origin/main`.
   Al ser ancestro, no hay conflictos; si los hubiera, se resuelven a favor de UTMA
   salvo cambio válido detectado en el paso 2.
4. Pruebas y builds completos (como en el trabajo diario).
5. Volver a los nombres de servicio oficiales en `render.yaml`
   (`sistemalegal-api`, `sistemalegal-pdf`) y el destino del proxy en
   `frontend/vercel.json`, en un commit propio de la rama de integración.
6. `git push martin integracion/utma` y pull request contra `martin/main`.
7. **Esperar aprobación** antes del merge.
8. Después del merge: el servicio `sistemalegal-api` de Render ya despliega desde
   Martín; cargarle las variables nuevas (ver `despliegue.md`), crear el servicio
   PDF oficial y verificar `/health`, login, recarga y subida de un PDF.
