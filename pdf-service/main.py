"""Microservicio de extracción de texto de PDF.

Recibe los bytes de un PDF en el cuerpo de un POST y devuelve su texto y su
cantidad de páginas. No guarda nada: el backend es el único que habla con la
base y con el almacenamiento, y este servicio solo transforma.

Se usa pdfplumber porque respeta el orden de lectura de los escritos judiciales
(encabezados, columnas, tablas de liquidación) mejor que las alternativas de
Node. Un PDF escaneado (solo imagen) devuelve texto vacío: el OCR queda fuera
del MVP.
"""

from __future__ import annotations

import hmac
import io
import os

import pdfplumber
from fastapi import FastAPI, Header, HTTPException, Request

MEGAS_MAXIMO = int(os.environ.get("MEGAS_MAXIMO_ARCHIVO", "10"))
PAGINAS_MAXIMO = int(os.environ.get("PAGINAS_MAXIMO", "500"))
# Token compartido con el backend. Sin él, cualquiera podría usar el servicio
# público como extractor gratuito. Vacío = sin control (solo para desarrollo).
TOKEN = os.environ.get("PDF_SERVICE_TOKEN", "")

app = FastAPI(title="SistemaLegal — extracción de PDF", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def salud() -> dict[str, str]:
    return {"estado": "ok"}


@app.post("/extraer")
async def extraer(request: Request, x_servicio_token: str | None = Header(default=None)) -> dict[str, object]:
    if TOKEN and not hmac.compare_digest(x_servicio_token or "", TOKEN):
        raise HTTPException(status_code=401, detail="Token de servicio inválido.")

    contenido = await request.body()
    if not contenido:
        raise HTTPException(status_code=400, detail="El cuerpo está vacío.")
    if len(contenido) > MEGAS_MAXIMO * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"El PDF supera los {MEGAS_MAXIMO} MB.")
    if not contenido.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="El archivo no es un PDF.")

    try:
        with pdfplumber.open(io.BytesIO(contenido)) as pdf:
            paginas = len(pdf.pages)
            if paginas > PAGINAS_MAXIMO:
                raise HTTPException(status_code=413, detail=f"El PDF tiene más de {PAGINAS_MAXIMO} páginas.")
            textos = [(pagina.extract_text() or "").strip() for pagina in pdf.pages]
    except HTTPException:
        raise
    except Exception as error:  # pdfplumber/pdfminer lanzan tipos variados ante un PDF dañado
        raise HTTPException(status_code=422, detail="No se pudo leer el PDF; puede estar dañado o protegido.") from error

    # El salto de página se marca con un form feed: conserva la división sin
    # inventar texto que no está en el documento.
    texto = "\n\f\n".join(textos).replace("\x00", "")
    return {"texto": texto, "paginas": paginas}
