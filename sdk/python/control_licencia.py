"""SDK de licencias CONTROL para Python / FastAPI (Avendia).

Requiere `cryptography` y `httpx` (ambos ya están en Avendia).

    from control_licencia import ControlLicencia
    licencia = ControlLicencia(
        url=settings.control_url, clave=settings.control_licencia, producto="avendia",
        clave_publica_base64=settings.control_clave_publica, archivo="datos/licencia.json",
        huella=settings.dominio_publico, version=settings.version,
    )

    @app.on_event("startup")
    async def _licencia():
        estado = await licencia.iniciar()
        if not estado["valido"]:
            raise RuntimeError(f"Licencia no válida: {estado['motivo']}")

    app.add_middleware(licencia.middleware_asgi())        # 402 si deja de ser válida
"""
from __future__ import annotations

import base64
import hashlib
import json
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class ControlLicencia:
    def __init__(self, url: str, clave: str, producto: str, clave_publica_base64: str, archivo: str = "licencia.json",
                 huella: str | None = None, version: str | None = None, latido_horas: float = 24) -> None:
        self.url = url.rstrip("/")
        self.clave = clave.strip().upper()
        self.producto = producto
        self.publica = Ed25519PublicKey.from_public_bytes(base64.b64decode(clave_publica_base64))
        self.archivo = Path(archivo)
        self.version = version
        self.huella = huella or hashlib.sha256(socket.gethostname().encode()).hexdigest()[:32]
        self.latido_segundos = latido_horas * 3600
        self.estado: dict[str, Any] = {"valido": False, "payload": None, "motivo": "sin iniciar"}
        self._ultimo_latido = 0.0

    def verificar(self, token: str) -> dict | None:
        if not isinstance(token, str) or "." not in token:
            return None
        cuerpo, firma = token.split(".", 1)
        try:
            self.publica.verify(_b64url_decode(firma), cuerpo.encode())
            p = json.loads(_b64url_decode(cuerpo))
        except (InvalidSignature, ValueError):
            return None
        if p.get("clave") != self.clave or p.get("producto") != self.producto or p.get("huella") != self.huella:
            return None
        if datetime.fromisoformat(p["expira_en"].replace("Z", "+00:00")) < datetime.now(timezone.utc):
            return None
        return p

    async def _llamar(self, ruta: str, cuerpo: dict) -> dict:
        async with httpx.AsyncClient(timeout=10) as cliente:
            r = await cliente.post(f"{self.url}/api/v1/licencias/{ruta}", json={k: v for k, v in cuerpo.items() if v is not None})
        try:
            datos = r.json()
        except ValueError:
            datos = {}
        return {"ok": r.is_success, "status": r.status_code, **datos}

    def _procesar(self, r: dict) -> dict:
        if r.get("ok") and r.get("token"):
            p = self.verificar(r["token"])
            if p:
                try:
                    self.archivo.parent.mkdir(parents=True, exist_ok=True)
                    self.archivo.write_text(json.dumps({"token": r["token"], "guardado_en": datetime.now(timezone.utc).isoformat()}))
                except OSError:
                    pass
                self.estado = {"valido": True, "payload": p, "motivo": None}
                return self.estado
        if r.get("status") in (403, 404):
            self.estado = {"valido": False, "payload": r.get("licencia"), "motivo": r.get("error") or r.get("codigo") or "licencia inválida", "codigo": r.get("codigo")}
        return self.estado

    async def activar(self) -> dict:
        return self._procesar(await self._llamar("activar", {
            "clave": self.clave, "producto": self.producto, "huella": self.huella,
            "dominio": self.huella, "nombre_equipo": socket.gethostname(), "version": self.version,
        }))

    async def latido(self) -> dict:
        self._ultimo_latido = time.time()
        return self._procesar(await self._llamar("latido", {"clave": self.clave, "huella": self.huella, "version": self.version}))

    async def iniciar(self) -> dict:
        """Token guardado si es válido; si no, activa. Sin red, vale hasta expira_en."""
        guardado = None
        try:
            guardado = json.loads(self.archivo.read_text()).get("token")
        except (OSError, ValueError):
            pass
        p = self.verificar(guardado) if guardado else None
        if p:
            self.estado = {"valido": True, "payload": p, "motivo": None}
        try:
            await (self.latido() if p else self.activar())
        except httpx.HTTPError as e:
            if not p:
                self.estado = {"valido": False, "payload": None, "motivo": f"Sin conexión con CONTROL: {e}"}
        return self.estado

    def vigente(self) -> bool:
        p = self.estado.get("payload") or {}
        expira = p.get("expira_en")
        if self.estado.get("valido"):
            return True
        return bool(expira) and datetime.fromisoformat(expira.replace("Z", "+00:00")) > datetime.now(timezone.utc)

    def middleware_asgi(self, rutas_libres: tuple[str, ...] = ("/api/v1/salud", "/docs", "/openapi.json")):
        """Middleware ASGI puro: responde 402 cuando la licencia no está vigente y renueva el latido."""
        licencia = self

        class Middleware:
            def __init__(self, app):
                self.app = app

            async def __call__(self, scope, receive, send):
                if scope["type"] != "http" or scope["path"].startswith(rutas_libres):
                    return await self.app(scope, receive, send)
                if time.time() - licencia._ultimo_latido > licencia.latido_segundos:
                    try:
                        await licencia.latido()
                    except httpx.HTTPError:
                        pass
                if not licencia.vigente():
                    cuerpo = json.dumps({"error": "Licencia no válida", "motivo": licencia.estado.get("motivo"), "codigo": licencia.estado.get("codigo")}).encode()
                    await send({"type": "http.response.start", "status": 402, "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": cuerpo})
                    return
                return await self.app(scope, receive, send)

        return Middleware
