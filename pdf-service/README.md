# pdf-service

Microservicio de extracción de texto de PDF (Python + FastAPI + pdfplumber).

| Ruta | Qué hace |
|---|---|
| `GET /health` | Estado del servicio. |
| `POST /extraer` | Cuerpo: los bytes del PDF. Devuelve `{ "texto": "...", "paginas": 3 }`. |

El backend lo llama después de guardar un PDF (`backend/src/modulos/documentos/extraccion.ts`)
y guarda el resultado en `documento_texto`, donde lo indexa la búsqueda de texto completo.
Si el servicio no está configurado o no responde, el documento se guarda igual y la
extracción se reintenta desde la pantalla.

## Variables

| Variable | Por defecto | Uso |
|---|---|---|
| `PDF_SERVICE_TOKEN` | vacío | Token compartido con el backend (cabecera `X-Servicio-Token`). Obligatorio en producción. |
| `MEGAS_MAXIMO_ARCHIVO` | `10` | Tamaño máximo aceptado. |
| `PAGINAS_MAXIMO` | `500` | Páginas máximas por documento. |

## Local

```bash
docker compose up pdf
curl -X POST --data-binary @escrito.pdf http://localhost:8000/extraer
```

Un PDF escaneado (solo imagen) devuelve texto vacío: el OCR queda fuera del MVP.
