# CONTROL · Especificación del panel central

CONTROL es el sistema propio de la agencia para **vender, licenciar y cobrar** todos los
productos del catálogo (DENTAL-PRO, FarmaSys, Repara-Pro, GYM-PRO, Supero-Pos, Sencillo,
Vendly, Habitta, ReservaFlow, Avendia, BARBER-PRO y los que vengan) desde un solo lugar.

Resuelve cuatro cosas:

1. **Licencias**: cada instalación de un producto tiene una clave única, atada a un equipo o
   dominio, con vencimiento y estado. Los productos consultan a CONTROL para saber si pueden
   funcionar.
2. **Ventas y comisiones**: un equipo de vendedores registra ventas; cada cobro confirmado
   devenga automáticamente la comisión del vendedor (20 % por defecto).
3. **Caja diaria**: cada vendedor cierra su caja al final del día y el superadministrador la
   aprueba. Las comisiones se liquidan aparte, por periodo.
4. **Control y auditoría**: el superadministrador ve todo, delega en administradores con
   límites, y cada acción queda registrada con autor, fecha y motivo.

---

## 1. Roles

| Rol | Qué puede hacer | Qué no puede hacer |
|---|---|---|
| **Superadmin** (dueño de la agencia) | Todo: productos, precios, usuarios, aprobar pagos y cierres, revocar, transferir y resetear licencias, liquidar comisiones, ver auditoría completa | — |
| **Admin** (persona de confianza) | Registrar ventas y cobros, confirmar pagos, emitir licencias dentro de su tope diario, ver todos los clientes y licencias | Cambiar precios, gestionar usuarios, revocar o resetear licencias, aprobar cierres, liquidar comisiones, borrar auditoría |
| **Vendedor** | Registrar ventas y cobros de sus clientes, generar licencias demo dentro de su tope semanal, cerrar su caja del día, ver sus comisiones y sus renovaciones próximas | Ver clientes, ventas o comisiones de otros vendedores; confirmar pagos; tocar licencias activas |
| **Cliente final** (portal, fase 2) | Ver sus licencias y vencimientos, descargar recibos, pagar renovaciones | — |

Todo usuario con rol admin o vendedor tiene un **tope diario de emisiones** y un
**porcentaje de comisión** propios; el superadmin los define.

---

## 2. Catálogo: productos y planes

- Un **producto** es un software del catálogo (`dental-pro`, `farmasys`, …).
- Cada producto tiene **planes**. Un plan define precio, duración y cuántas activaciones
  admite una licencia de ese plan.

| Tipo de plan | Duración | Uso |
|---|---|---|
| `mensual` | 30 días, renovable | Suscripción |
| `anual` | 365 días, renovable | Suscripción con descuento |
| `vitalicio` | Sin vencimiento del uso; **soporte y actualizaciones 365 días**, renovables como mantenimiento | Venta única |
| `sucursal_extra` | Hereda la duración de la licencia principal | Ampliación: una licencia nueva por sucursal |
| `mantenimiento` | 365 días | Renueva soporte/actualizaciones de un vitalicio |
| `demo` | 7 a 15 días, no renovable | Prueba; la genera el vendedor sin aprobación |

Los precios se definen en la **moneda base** de la agencia (USD por defecto). La venta
registra la moneda y el tipo de cambio con que se cobró.

---

## 3. Flujo de una venta

```
Vendedor registra venta ──► Licencias en PENDIENTE_PAGO ──► Cobro registrado
        │                                                        │
        │                                              Admin/Superadmin confirma
        │                                                        │
        ▼                                                        ▼
  Descuento ≤ tope permitido                 Licencias ACTIVAS · Comisión DEVENGADA
                                                                 │
                                                       Cliente activa el producto
                                                                 │
                                              Huella registrada · Token firmado emitido
```

1. **Registro**: producto, plan, cliente, cantidad de sucursales, descuento y notas. El
   sistema calcula `total = precio_plan × cantidad × (1 − descuento)`. El descuento no puede
   superar el tope configurado (10 % por defecto).
2. **Licencias**: se crean tantas licencias como sucursales, todas en estado
   `pendiente_pago`, con etiqueta editable ("Sucursal Centro", "Sucursal Norte").
3. **Cobro**: el vendedor registra el pago (efectivo, transferencia, Yape, Plin, tarjeta,
   PayPal, otro) con referencia y comprobante. Queda `pendiente` hasta que un admin o el
   superadmin lo confirma. Los pagos por pasarela (fase 2) se confirman solos vía webhook.
4. **Confirmación**: al confirmar un pago se devenga la comisión sobre **ese monto**. Cuando
   la suma de pagos confirmados cubre el total, la venta pasa a `pagada` y sus licencias a
   `activa`, con `vence_en` calculado según el plan.
5. **Activación**: el producto envía clave + huella del equipo o dominio. Si la licencia está
   activa y no superó su máximo de activaciones, CONTROL registra la huella y devuelve un
   **token firmado (Ed25519)** válido por 7 días. El producto lo verifica sin internet con la
   clave pública y lo renueva con un latido periódico.

---

## 4. Comisiones

| Situación | Regla por defecto |
|---|---|
| Venta vitalicia, anual o mensual (primer año) | 20 % de cada pago confirmado |
| Renovación después del primer año | 10 % (`comision_renovacion_pct`) |
| Sucursal adicional y mantenimiento | 20 % del monto cobrado |
| Venta anulada o devuelta | La comisión pasa a `revertida` y se descuenta de la próxima liquidación |

Principios:

- La comisión **nace con el dinero confirmado**, nunca al emitir la licencia.
- Se calcula sobre el **precio neto cobrado**, después del descuento.
- Cada usuario puede tener su propio porcentaje; un plan puede fijar un porcentaje distinto
  que prevalece sobre el del vendedor.
- Estados: `devengada` → `liquidada` (incluida en una liquidación pagada) o `revertida`.

---

## 5. Caja diaria y liquidaciones

**Cierre de caja** (uno por vendedor y por día):

- Suma lo **cobrado ese día** por el vendedor, desglosado por método de pago.
- Muestra la comisión devengada del día (informativa; no se descuenta de la caja).
- `a_entregar` = efectivo y cobros manuales que el vendedor debe entregar a la agencia.
- El vendedor cierra; el superadmin **aprueba** u **observa** (con comentario). Un cierre
  aprobado es inmutable.

**Liquidación de comisiones** (semanal o quincenal, la crea el superadmin):

- Toma todas las comisiones `devengadas` del vendedor en el rango de fechas, resta las
  `revertidas`, y genera un recibo con el total.
- Al marcarla `pagada`, las comisiones incluidas pasan a `liquidada`.

---

## 6. Reglas de licencias

- **Una licencia = una instalación.** `max_activaciones` es 1 por defecto. Si un cliente
  tiene tres sucursales, tiene tres licencias agrupadas bajo su cuenta.
- **Ampliar sucursales** es una venta del plan `sucursal_extra`, con su precio y su comisión.
- **Cambio de equipo**: solo el superadmin puede **resetear** las activaciones de una
  licencia, indicando el motivo. Queda en auditoría.
- **Demo**: el vendedor genera licencias demo sin aprobación, hasta su tope semanal. El panel
  muestra cuántas demos convirtió en venta cada vendedor.

Estados de una licencia:

| Estado | Significado | El producto… |
|---|---|---|
| `pendiente_pago` | Vendida, sin cobro confirmado | No arranca |
| `activa` | Vigente | Funciona |
| `mora` | Vencida, dentro del periodo de gracia (7 días) | Funciona con aviso |
| `suspendida` | Superó la gracia o el superadmin la pausó | Bloqueado, datos intactos |
| `vencida` | Demo o plan terminado sin renovar | Bloqueado |
| `revocada` | Anulada por devolución o fraude | Bloqueado, no se puede reactivar |

---

## 7. Latido, alertas y auditoría

- Cada instalación envía un **latido** cada 24 h con su versión. Sirve para detectar
  instalaciones muertas, clonadas o desactualizadas.
- **Alertas** que ve el superadmin en su panel: intentos de activación rechazados,
  admins que superan su tope de emisiones, licencias que vencen en 30 días, cierres
  observados, vendedores con devoluciones.
- **Auditoría**: tabla de solo inserción con usuario, acción, entidad, detalle e IP. Nada se
  borra.

---

## 8. Modelo de datos

```
usuarios        id, email, nombre, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, activo
productos       id, codigo, nombre, descripcion, activo
planes          id, producto_id, codigo, nombre, tipo, precio, duracion_dias, max_activaciones, comision_pct
clientes        id, nombre, empresa, email, telefono, pais, moneda, vendedor_id
ventas          id, numero, cliente_id, vendedor_id, creado_por, producto_id, plan_id,
                cantidad, precio_unitario, descuento_pct, total, moneda, tipo_cambio, estado, es_renovacion
pagos           id, venta_id, monto, metodo, referencia, comprobante, estado,
                registrado_por, confirmado_por, confirmado_en
licencias       id, clave, venta_id, cliente_id, producto_id, plan_id, vendedor_id, emitida_por,
                etiqueta, estado, max_activaciones, activa_desde, vence_en, soporte_hasta, motivo_estado
activaciones    id, licencia_id, huella, dominio, nombre_equipo, version, ip, activada_en, ultimo_latido, activa
comisiones      id, venta_id, pago_id, vendedor_id, base, pct, monto, estado, liquidacion_id
cierres_caja    id, vendedor_id, fecha, total_cobrado, por_metodo, comision_dia, a_entregar,
                estado, observacion, aprobado_por, aprobado_en
liquidaciones   id, vendedor_id, desde, hasta, total, estado, pagada_en, creado_por
auditoria       id, usuario_id, accion, entidad, entidad_id, detalle, ip, creado_en
ajustes         clave, valor
```

---

## 9. Fases

| Fase | Entregable | Estado |
|---|---|---|
| 1 | API + panel: roles, catálogo, ventas, pagos, licencias firmadas, comisiones, caja, auditoría | **Esta entrega** |
| 2 | SDK integrado en cada producto del catálogo; latido en producción | SDK de ejemplo incluido |
| 3 | Pasarelas (Stripe, PayPal, Culqi) con confirmación automática; portal del cliente | Pendiente |
| 4 | Metas y ranking de vendedores, enlaces de venta con código, WhatsApp automático | Pendiente |
| 5 | Revendedores externos con stock de licencias y marca blanca | Pendiente |
