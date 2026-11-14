"""Pruebas del microservicio de extracción. Correr con: pytest -q"""

import importlib

from fastapi.testclient import TestClient


def pdf_minimo(texto: str) -> bytes:
    """PDF válido de una página con `texto`, armado a mano para no depender de archivos."""
    flujo = f"BT /F1 14 Tf 72 720 Td ({texto}) Tj ET"
    objetos = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(flujo)} >>\nstream\n{flujo}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    salida, posiciones = "%PDF-1.4\n", []
    for i, obj in enumerate(objetos, start=1):
        posiciones.append(len(salida))
        salida += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n0000000000 65535 f \n"
    salida += "".join(f"{p:010d} 00000 n \n" for p in posiciones)
    salida += f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return salida.encode("latin-1")


def cliente(monkeypatch, token: str = "") -> TestClient:
    monkeypatch.setenv("PDF_SERVICE_TOKEN", token)
    import main

    return TestClient(importlib.reload(main).app)


def test_health(monkeypatch):
    assert cliente(monkeypatch).get("/health").json() == {"estado": "ok"}


def test_extrae_texto_y_paginas(monkeypatch):
    r = cliente(monkeypatch).post("/extraer", content=pdf_minimo("Cedula de notificacion"))
    assert r.status_code == 200
    assert r.json() == {"texto": "Cedula de notificacion", "paginas": 1}


def test_rechaza_lo_que_no_es_pdf(monkeypatch):
    assert cliente(monkeypatch).post("/extraer", content=b"MZ\x90\x00").status_code == 415


def test_rechaza_cuerpo_vacio(monkeypatch):
    assert cliente(monkeypatch).post("/extraer", content=b"").status_code == 400


def test_pdf_danado_responde_422(monkeypatch):
    assert cliente(monkeypatch).post("/extraer", content=b"%PDF-1.4 roto").status_code == 422


def test_exige_el_token_si_esta_configurado(monkeypatch):
    c = cliente(monkeypatch, token="secreto-de-prueba")
    assert c.post("/extraer", content=pdf_minimo("x")).status_code == 401
    ok = c.post("/extraer", content=pdf_minimo("x"), headers={"X-Servicio-Token": "secreto-de-prueba"})
    assert ok.status_code == 200
