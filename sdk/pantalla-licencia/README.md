# Pantalla estándar "Licencia"

Todos los productos muestran la misma pantalla de licencia para que soporte y ventas la
reconozcan al instante. Contiene:

| Bloque | Origen |
|---|---|
| Estado (activa, en mora, suspendida, vencida, revocada) y motivo | `resumen().estado` / `motivo` |
| Clave, plan, etiqueta (sede), equipo (huella) y versión instalada | `resumen()` |
| Vence, soporte hasta, "funciona sin internet hasta" | `vence_en`, `soporte_hasta`, `sin_conexion_hasta` |
| Aviso de versión nueva | `desactualizada` + `version_actual` (lo informa CONTROL en cada latido) |
| Botón **Reactivar / verificar ahora** | `activar()` |
| Campo **Código de emergencia** (72 h) | `aplicarCodigoEmergencia(codigo)` |

## Node (Express, NestJS, Next.js con servidor propio)

```js
app.use('/licencia', licencia.pantallaExpress({ nombre: 'DENTAL-PRO' }));
```

Sirve la pantalla en `GET /licencia`, el JSON en `GET /licencia/estado.json` y procesa
`POST /licencia/reactivar` y `POST /licencia/emergencia`. Añade `/licencia` a `rutasLibres`
del middleware para que se pueda abrir aunque la licencia esté bloqueada.

## Laravel

```php
// routes/web.php
Route::get('/licencia', fn () => view('licencia', $licencia->resumen()));
Route::post('/licencia/reactivar', function () use ($licencia) { $licencia->activar(); return back(); });
Route::post('/licencia/emergencia', function (Request $r) use ($licencia) {
    $res = $licencia->aplicarCodigoEmergencia($r->input('codigo'));
    return back()->with('aviso', $res['ok'] ? 'Código aplicado' : $res['motivo']);
});
```

`licencia.blade.php` puede partir de `plantilla.html` de esta carpeta.

## FastAPI

```python
@app.get("/licencia")
async def licencia_json():
    return licencia.resumen()

@app.post("/licencia/emergencia")
async def licencia_emergencia(codigo: str = Form(...)):
    return licencia.aplicar_codigo_emergencia(codigo)
```

## Electron / PWA

Usa `plantilla.html` como vista y rellena los `data-campo` con `resumen()`; el botón
"Reactivar" llama a `activar()` y el formulario de emergencia a `aplicarCodigoEmergencia()`.

## Código de emergencia

Lo emite un vendedor o admin desde CONTROL → Licencia → **Código de emergencia**, indicando
el equipo (huella) y el motivo. Es un token firmado con la clave privada de la agencia,
válido 72 h y solo para ese equipo; el producto lo acepta sin red porque lo verifica con la
clave pública embebida. Sirve para: CONTROL caído, cliente sin internet en una fecha crítica,
o desbloquear mientras se regulariza un pago. Queda auditado.
