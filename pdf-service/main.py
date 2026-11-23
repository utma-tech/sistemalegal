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

import asyncio
import hmac
import io
import os

import pdfplumber
from fastapi import FastAPI, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

MEGAS_MAXIMO = int(os.environ.get("MEGAS_MAXIMO_ARCHIVO", "10"))
PAGINAS_MAXIMO = int(os.environ.get("PAGINAS_MAXIMO", "500"))
# Tope de tiempo por PDF. Uno armado a propósito (o simplemente patológico)
# puede tener a pdfminer minutos procesando; pasado este tiempo se responde
# 504 y el backend marca la extracción como fallida.
SEGUNDOS_MAXIMO = float(os.environ.get("SEGUNDOS_MAXIMO_EXTRACCION", "60"))

# Token compartido con el backend. Sin él, cualquiera podría usar el servicio
# público como extractor gratuito.
TOKEN = os.environ.get("PDF_SERVICE_TOKEN", "")
# Cerrado por defecto: sin token, el servicio no extrae nada salvo que se lo
# habilite explícitamente para desarrollo (docker compose lo hace). Así, olvidar
# la variable en Render deja el servicio inútil, no abierto a internet.
SIN_TOKEN_PERMITIDO = os.environ.get("PDF_SIN_TOKEN") == "1"

BYTES_MAXIMO = MEGAS_MAXIMO * 1024 * 1024

app = FastAPI(title="SistemaLegal — extracción de PDF", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def salud() -> dict[str, str]:
    return {"estado": "ok"}


def _verificar_token(recibido: str | None) -> None:
    if not TOKEN:
        if SIN_TOKEN_PERMITIDO:
            return
        raise HTTPException(status_code=503, detail="El servicio no tiene configurado PDF_SERVICE_TOKEN.")
    if not hmac.compare_digest(recibido or "", TOKEN):
        raise HTTPException(status_code=401, detail="Token de servicio inválido.")


async def _leer_cuerpo(request: Request) -> bytes:
    """Lee el cuerpo cortando apenas supera el tope, sin cargarlo entero antes de medirlo."""
    declarado = request.headers.get("content-length")
    if declarado and declarado.isdigit() and int(declarado) > BYTES_MAXIMO:
        raise HTTPException(status_code=413, detail=f"El PDF supera los {MEGAS_MAXIMO} MB.")

    partes: list[bytes] = []
    total = 0
    async for parte in request.stream():
        total += len(parte)
        if total > BYTES_MAXIMO:
            raise HTTPException(status_code=413, detail=f"El PDF supera los {MEGAS_MAXIMO} MB.")
        partes.append(parte)
    return b"".join(partes)


def _extraer(contenido: bytes) -> dict[str, object]:
    with pdfplumber.open(io.BytesIO(contenido)) as pdf:
        paginas = len(pdf.pages)
        if paginas > PAGINAS_MAXIMO:
            raise HTTPException(status_code=413, detail=f"El PDF tiene más de {PAGINAS_MAXIMO} páginas.")
        textos = [(pagina.extract_text() or "").strip() for pagina in pdf.pages]

    # El salto de página se marca con un form feed: conserva la división sin
    # inventar texto que no está en el documento.
    texto = "\n\f\n".join(textos).replace("\x00", "")
    return {"texto": texto, "paginas": paginas}


@app.post("/extraer")
async def extraer(request: Request, x_servicio_token: str | None = Header(default=None)) -> dict[str, object]:
    _verificar_token(x_servicio_token)

    contenido = await _leer_cuerpo(request)
    if not contenido:
        raise HTTPException(status_code=400, detail="El cuerpo está vacío.")
    if not contenido.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="El archivo no es un PDF.")

    # pdfplumber es sincrónico: en un hilo aparte para no frenar el resto de las
    # peticiones mientras procesa, y con tope de tiempo.
    try:
        return await asyncio.wait_for(run_in_threadpool(_extraer, contenido), timeout=SEGUNDOS_MAXIMO)
    except HTTPException:
        raise
    except asyncio.TimeoutError as error:
        raise HTTPException(status_code=504, detail="El PDF tardó demasiado en procesarse.") from error
    except Exception as error:  # pdfplumber/pdfminer lanzan tipos variados ante un PDF dañado
        raise HTTPException(status_code=422, detail="No se pudo leer el PDF; puede estar dañado o protegido.") from error
