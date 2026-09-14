# Precios y posicionamiento

## La idea, en una frase

Vender **software listo, barato y bueno** a negocios pequeños que nunca podrían pagar un
desarrollo a medida. No competimos con la agencia que cobra 5 000 USD por un sistema:
competimos con el cuaderno, el Excel y el WhatsApp. El precio tiene que sentirse como un
gasto menor del mes, no como una inversión que hay que pensar.

## Principios de precio

1. **El precio sigue al negocio, no al software.** Una bodega factura y gana mucho menos que
   una clínica dental; aunque el sistema cueste lo mismo de hacer, no puede costar lo mismo
   de comprar. Por eso hay cuatro niveles según la capacidad de pago del rubro.
2. **Tres formas de pagar, siempre las mismas:** mensual (entrar sin miedo), anual (ahorra
   dos meses y media) y vitalicio (una sola vez, el favorito del pequeño negocio que odia las
   cuotas). El vendedor ofrece las tres y deja elegir.
3. **Una licencia por instalación.** Cada sede o equipo es una licencia. La sucursal
   adicional cuesta menos que la primera porque ya conocen el sistema.
4. **Todo cliente prueba gratis 7 días** con la demo. Vender sin demo es vender a ciegas.
5. **Vitalicio no significa gratis para siempre:** incluye 12 meses de actualizaciones y
   soporte; después, un mantenimiento anual opcional (20 % del vitalicio). Quien no lo pague
   sigue usando su versión sin problema.
6. **Comisión del 20 % sobre lo cobrado**, en cualquiera de los tres planes. Al vendedor le
   conviene el vitalicio (cobra más de una vez); a la agencia le conviene el anual (ingreso
   recurrente). Ambos ganan con cualquiera.

## Niveles según el tipo de negocio

| Nivel | Para quién | Mensual | Anual | Vitalicio | Sucursal adicional (vitalicio) |
|---|---|---|---|---|---|
| **1 · Micro** | Bodegas, puestos de mercado, kioscos | **7 USD** | **59 USD** | **149 USD** | 59 USD |
| **2 · Servicios simples** | Barberías, salones, talleres de celulares, reservas, POS de tienda pequeña | **15 USD** | **129 USD** | **299 USD** | 119 USD |
| **3 · Negocio establecido** | Gimnasios, minimarkets con POS, tiendas online, oficinas que producen documentos | **25 USD** | **219 USD** | **499 USD** | 199 USD |
| **4 · Profesional regulado** | Clínicas dentales, farmacias, inmobiliarias | **39 USD** | **349 USD** | **790 USD** | 319 USD |

Regla que sostiene los números: **anual = 9,5 meses** (ahorra 2,5 meses),
**vitalicio = 20 meses** (se paga en menos de dos años), **sucursal adicional = 40 % del
vitalicio**, **mantenimiento anual = 20 % del vitalicio**.

Referencia en soles (tipo de cambio 3,75): nivel 1 desde S/ 26 al mes o S/ 560 de por vida;
nivel 4 desde S/ 146 al mes o S/ 2 960 de por vida. Los precios se cobran en la moneda del
cliente con el tipo de cambio que fija Ajustes.

## Precio por producto

| Producto | Rubro | Nivel | Mensual | Anual | Vitalicio | Sucursal | Mantenimiento/año |
|---|---|---|---|---|---|---|---|
| Sencillo (Kiosco.PE) | Bodegas y kioscos | 1 | 7 | 59 | 149 | 59 | 30 |
| BARBER-PRO | Barberías y salones | 2 | 15 | 129 | 299 | 119 | 60 |
| ReservaFlow | Reservas (spa, canchas, consultorios simples) | 2 | 15 | 129 | 299 | 119 | 60 |
| Repara-Pro | Talleres de celulares | 2 | 15 | 129 | 299 | 119 | 60 |
| Supero POS | Punto de venta de escritorio | 2 | 15 | 129 | 299 | 119 | 60 |
| GYM-PRO | Gimnasios | 3 | 25 | 219 | 499 | 199 | 100 |
| Vendly | Tiendas online | 3 | 25 | 219 | 499 | 199 | 100 |
| Avendia 3.0 | Documentos con IA | 3 | 25 | 219 | 499 | 199 | 100 |
| Habitta | Inmobiliarias | 4 | 39 | 349 | 790 | 319 | 158 |
| FarmaSys | Farmacias | 4 | 39 | 349 | 790 | 319 | 158 |
| DENTAL-PRO | Clínicas dentales | 4 | 39 | 349 | 790 | 319 | 158 |

Todos en USD, sin impuestos. Estos son los precios de lista que carga `npm run seed`.

## Cómo se cambian los precios (solo el dueño)

En **Lista de precios › Editar precios** el superadmin edita las celdas, aplica un nivel
(N1 a N4) a un producto con un clic, o sube o baja toda la lista un porcentaje. Cada cambio
queda en el historial con quién lo hizo y por qué. En cuanto guarda:

- Los vendedores y admins ven la lista nueva al instante y cada venta nueva la usa: el
  precio nunca se escribe a mano, sale del catálogo.
- Las ventas ya registradas conservan su precio; las renovaciones futuras usan el nuevo.
- El descuento que puede aplicar cada rol lo fija el dueño en Ajustes › Ventas (vendedor 10 %
  y admin 15 % por defecto). Por encima, el sistema rechaza la venta.

El **simulador** de la misma página muestra, para cualquier producto, plan, cantidad de sedes,
descuento y moneda, qué paga el cliente, qué gana el vendedor y qué recibe la agencia. La
página **Cómo funciona** explica el recorrido de una venta y quién puede hacer qué.

## Qué incluye cada plan

| | Mensual | Anual | Vitalicio |
|---|---|---|---|
| Uso del sistema en 1 instalación | Sí | Sí | Sí, sin vencimiento |
| Actualizaciones | Mientras pague | Mientras pague | 12 meses; luego mantenimiento opcional |
| Soporte por WhatsApp y portal | Sí | Sí | 12 meses; luego mantenimiento opcional |
| Instalación y capacitación inicial | Remota, incluida | Remota, incluida | Remota, incluida |
| Si deja de pagar | 7 días de gracia (mora) y luego se suspende | Igual | Sigue funcionando sin actualizaciones |

## Cómo lo vende el equipo

- **Ancla en el dolor, no en el software:** "¿cuánto pierdes al mes por fiados que olvidas,
  citas que no llegan, stock que se vence?" Cualquier nivel cuesta menos que eso.
- **Abre con el mensual** para quitar el miedo, **cierra con el vitalicio** cuando el
  cliente diga "¿y si lo pago de una vez?". La mayoría de negocios pequeños prefiere no
  tener cuotas.
- **La demo de 7 días se instala en la primera visita.** El cierre se hace al día 5 o 6,
  antes de que venza.
- **Sucursal adicional** se ofrece a los tres meses, cuando el cliente ya vive con el
  sistema. Nunca en la primera venta.
- **Nunca regales el mantenimiento.** Es lo que paga el soporte del año siguiente.

## Márgenes de maniobra del vendedor

| Situación | Permitido | Necesita aprobación del superadmin |
|---|---|---|
| Cliente que trae a otro negocio | 1 mes gratis al que refiere | — |
| Pago anual o vitalicio en efectivo | Hasta 10 % de descuento | Más del 10 % |
| Tres o más licencias en una venta | Precio de sucursal adicional desde la segunda | Cambiar el precio de la primera |
| Cliente en mora que quiere volver | Reactivar sin penalidad | Condonar meses vencidos |
| Revendedor | Descuento mayorista fijado en su usuario (30 % sugerido) y cupo prepagado | Cambiar su descuento |

## Cuánto deja cada venta

Ejemplo con la comisión estándar del 20 %:

| Venta | Cliente paga | Vendedor gana | Agencia recibe |
|---|---|---|---|
| Barbería, mensual | 15 USD/mes | 3 USD/mes mientras pague | 12 USD/mes |
| Gimnasio, anual | 219 USD | 43,80 USD | 175,20 USD |
| Clínica dental, vitalicio | 790 USD | 158 USD | 632 USD |
| Clínica dental, vitalicio + 2 sedes | 1 428 USD | 285,60 USD | 1 142,40 USD |

Un vendedor que cierre 10 barberías al mes en vitalicio gana 598 USD ese mes y sigue cobrando
20 % de cada mantenimiento anual que renueven. Esa es la historia que se le cuenta al
reclutar.

## Cuándo revisar los precios

- Si más del 70 % de los cierres son vitalicios, el vitalicio está barato: súbelo un nivel.
- Si la demo no se convierte en más del 30 % de los casos, el problema no es el precio, es
  el producto o la capacitación.
- Cada seis meses, con el reporte de cobros por producto (Reportes), se decide producto por
  producto. El cambio se hace en Catálogo y solo afecta ventas nuevas: las licencias
  vendidas conservan su precio de renovación.
