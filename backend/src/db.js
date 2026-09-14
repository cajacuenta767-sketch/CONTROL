import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

let db;

/** Conexión única a SQLite. Se crea y migra en el primer uso. */
export function obtenerDb() {
  if (!db) {
    if (config.rutaBaseDatos !== ':memory:') {
      mkdirSync(dirname(config.rutaBaseDatos), { recursive: true });
    }
    db = new DatabaseSync(config.rutaBaseDatos);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrar(db);
  }
  return db;
}

/** Ejecuta fn dentro de una transacción; revierte si lanza. */
export function transaccion(fn) {
  const d = obtenerDb();
  d.exec('BEGIN');
  try {
    const resultado = fn(d);
    d.exec('COMMIT');
    return resultado;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Solo para tests: cierra y descarta la conexión. */
export function reiniciarDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

const MIGRACIONES = [
  {
    version: 1,
    sql: `
      CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        hash_clave TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('superadmin','admin','vendedor')),
        comision_pct REAL NOT NULL DEFAULT 20,
        tope_emisiones_dia INTEGER NOT NULL DEFAULT 20,
        tope_demos_semana INTEGER NOT NULL DEFAULT 10,
        telefono TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE planes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        codigo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('mensual','anual','vitalicio','sucursal_extra','mantenimiento','demo')),
        precio REAL NOT NULL DEFAULT 0,
        duracion_dias INTEGER,
        max_activaciones INTEGER NOT NULL DEFAULT 1,
        comision_pct REAL,
        activo INTEGER NOT NULL DEFAULT 1,
        UNIQUE (producto_id, codigo)
      );

      CREATE TABLE clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        empresa TEXT,
        email TEXT,
        telefono TEXT,
        pais TEXT,
        moneda TEXT NOT NULL DEFAULT 'USD',
        notas TEXT,
        vendedor_id INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT NOT NULL UNIQUE,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
        creado_por INTEGER NOT NULL REFERENCES usuarios(id),
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        plan_id INTEGER NOT NULL REFERENCES planes(id),
        renueva_licencia_id INTEGER REFERENCES licencias(id),
        cantidad INTEGER NOT NULL DEFAULT 1,
        precio_unitario REAL NOT NULL,
        descuento_pct REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        moneda TEXT NOT NULL DEFAULT 'USD',
        tipo_cambio REAL NOT NULL DEFAULT 1,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','anulada')),
        es_renovacion INTEGER NOT NULL DEFAULT 0,
        notas TEXT,
        motivo_anulacion TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        pagada_en TEXT
      );

      CREATE TABLE pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        monto REAL NOT NULL,
        metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','transferencia','yape','plin','tarjeta','paypal','stripe','otro')),
        referencia TEXT,
        comprobante TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado','rechazado')),
        motivo_rechazo TEXT,
        registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
        confirmado_por INTEGER REFERENCES usuarios(id),
        confirmado_en TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE licencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT NOT NULL UNIQUE,
        venta_id INTEGER REFERENCES ventas(id),
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        plan_id INTEGER NOT NULL REFERENCES planes(id),
        vendedor_id INTEGER REFERENCES usuarios(id),
        emitida_por INTEGER NOT NULL REFERENCES usuarios(id),
        etiqueta TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente_pago'
          CHECK (estado IN ('pendiente_pago','activa','mora','suspendida','vencida','revocada')),
        max_activaciones INTEGER NOT NULL DEFAULT 1,
        activa_desde TEXT,
        vence_en TEXT,
        soporte_hasta TEXT,
        motivo_estado TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_licencias_cliente ON licencias(cliente_id);
      CREATE INDEX idx_licencias_estado ON licencias(estado);

      CREATE TABLE activaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licencia_id INTEGER NOT NULL REFERENCES licencias(id),
        huella TEXT NOT NULL,
        dominio TEXT,
        nombre_equipo TEXT,
        version TEXT,
        ip TEXT,
        activada_en TEXT NOT NULL DEFAULT (datetime('now')),
        ultimo_latido TEXT NOT NULL DEFAULT (datetime('now')),
        activa INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_activaciones_licencia ON activaciones(licencia_id);

      CREATE TABLE comisiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        pago_id INTEGER REFERENCES pagos(id),
        vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
        base REAL NOT NULL,
        pct REAL NOT NULL,
        monto REAL NOT NULL,
        estado TEXT NOT NULL DEFAULT 'devengada' CHECK (estado IN ('devengada','liquidada','revertida')),
        liquidacion_id INTEGER REFERENCES liquidaciones(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE cierres_caja (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
        fecha TEXT NOT NULL,
        total_cobrado REAL NOT NULL DEFAULT 0,
        por_metodo TEXT NOT NULL DEFAULT '{}',
        comision_dia REAL NOT NULL DEFAULT 0,
        a_entregar REAL NOT NULL DEFAULT 0,
        cantidad_pagos INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'cerrado' CHECK (estado IN ('cerrado','aprobado','observado')),
        observacion TEXT,
        cerrado_en TEXT NOT NULL DEFAULT (datetime('now')),
        aprobado_por INTEGER REFERENCES usuarios(id),
        aprobado_en TEXT,
        UNIQUE (vendedor_id, fecha)
      );

      CREATE TABLE liquidaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
        desde TEXT NOT NULL,
        hasta TEXT NOT NULL,
        total REAL NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada')),
        pagada_en TEXT,
        creado_por INTEGER NOT NULL REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER REFERENCES usuarios(id),
        accion TEXT NOT NULL,
        entidad TEXT,
        entidad_id INTEGER,
        detalle TEXT,
        ip TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_auditoria_fecha ON auditoria(creado_en);

      CREATE TABLE ajustes (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
      INSERT INTO ajustes (clave, valor) VALUES
        ('nombre_agencia', 'Mi Agencia'),
        ('moneda_base', 'USD'),
        ('tope_descuento_pct', '10'),
        ('comision_renovacion_pct', '10'),
        ('gracia_dias', '7'),
        ('demo_dias', '7'),
        ('soporte_vitalicio_dias', '365'),
        ('metodos_en_mano', 'efectivo'),
        ('desfase_horario_horas', '-5');
    `,
  },
  {
    version: 2,
    sql: `
      -- usuarios: seguridad, revendedores, marca blanca, código de referido
      CREATE TABLE usuarios_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        hash_clave TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('superadmin','admin','vendedor','revendedor')),
        comision_pct REAL NOT NULL DEFAULT 20,
        tope_emisiones_dia INTEGER NOT NULL DEFAULT 20,
        tope_demos_semana INTEGER NOT NULL DEFAULT 10,
        telefono TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        intentos_fallidos INTEGER NOT NULL DEFAULT 0,
        bloqueado_hasta TEXT,
        debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
        totp_secreto TEXT,
        totp_activo INTEGER NOT NULL DEFAULT 0,
        codigo_ref TEXT UNIQUE,
        cupo_licencias INTEGER,
        descuento_mayorista_pct REAL,
        marca_nombre TEXT,
        ultimo_acceso TEXT
      );
      INSERT INTO usuarios_v2 (id, email, nombre, hash_clave, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, activo, creado_en)
        SELECT id, email, nombre, hash_clave, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, activo, creado_en FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios_v2 RENAME TO usuarios;

      CREATE TABLE sesiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        hash_token TEXT NOT NULL UNIQUE,
        ip TEXT, agente TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        expira_en TEXT NOT NULL,
        ultimo_uso TEXT NOT NULL DEFAULT (datetime('now')),
        revocada INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE tokens_recuperacion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        hash_token TEXT NOT NULL UNIQUE,
        expira_en TEXT NOT NULL,
        usado_en TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE correos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        para TEXT NOT NULL, asunto TEXT NOT NULL, html TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','error','sin_smtp')),
        error TEXT, creado_en TEXT NOT NULL DEFAULT (datetime('now')), enviado_en TEXT
      );

      -- dinero
      ALTER TABLE ventas ADD COLUMN total_base REAL;
      UPDATE ventas SET total_base = total;
      ALTER TABLE pagos ADD COLUMN comprobante_archivo TEXT;
      ALTER TABLE pagos ADD COLUMN enlace_pago_id INTEGER;
      ALTER TABLE pagos ADD COLUMN monto_base REAL;
      UPDATE pagos SET monto_base = monto;
      ALTER TABLE cierres_caja ADD COLUMN por_moneda TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE cierres_caja ADD COLUMN total_base REAL NOT NULL DEFAULT 0;
      UPDATE cierres_caja SET total_base = total_cobrado;
      ALTER TABLE productos ADD COLUMN version_actual TEXT;
      ALTER TABLE clientes ADD COLUMN hash_acceso TEXT;
      ALTER TABLE clientes ADD COLUMN origen TEXT;

      CREATE TABLE enlaces_pago (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        proveedor TEXT NOT NULL CHECK (proveedor IN ('demo','stripe','paypal')),
        id_externo TEXT, url TEXT NOT NULL,
        monto REAL NOT NULL, moneda TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','cancelado','expirado')),
        datos TEXT, creado_por INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now')), pagado_en TEXT
      );
      CREATE TABLE metas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        mes TEXT NOT NULL,
        objetivo_monto REAL NOT NULL,
        bono_pct REAL NOT NULL DEFAULT 5,
        creado_por INTEGER REFERENCES usuarios(id),
        UNIQUE (usuario_id, mes)
      );
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        licencia_id INTEGER REFERENCES licencias(id),
        asunto TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','respondido','cerrado')),
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ticket_mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        autor_tipo TEXT NOT NULL CHECK (autor_tipo IN ('cliente','agencia')),
        usuario_id INTEGER REFERENCES usuarios(id),
        texto TEXT NOT NULL,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE notificaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        referencia TEXT NOT NULL,
        canal TEXT NOT NULL,
        detalle TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (tipo, referencia)
      );
      CREATE TABLE codigos_emergencia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licencia_id INTEGER NOT NULL REFERENCES licencias(id),
        huella TEXT NOT NULL,
        expira_en TEXT NOT NULL,
        creado_por INTEGER NOT NULL REFERENCES usuarios(id),
        motivo TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE errores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mensaje TEXT NOT NULL, pila TEXT, ruta TEXT, usuario_id INTEGER,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO ajustes (clave, valor) VALUES
        ('url_publica', 'http://localhost:5173'),
        ('direccion_agencia', ''),
        ('logo_url', ''),
        ('tipos_cambio', '{"USD":1,"PEN":3.75,"BOB":6.9,"COP":4100,"CLP":950,"MXN":18,"ARS":1000}'),
        ('smtp_host', ''), ('smtp_puerto', '587'), ('smtp_usuario', ''), ('smtp_clave', ''), ('smtp_desde', ''),
        ('stripe_clave_secreta', ''), ('stripe_webhook_secreto', ''),
        ('paypal_cliente', ''), ('paypal_secreto', ''), ('paypal_sandbox', '1'),
        ('pasarela_demo', '1'),
        ('plantilla_wa_claves', 'Hola {cliente}, gracias por tu compra de {producto}. {claves_intro}:\n\n{claves}\n\nActívala en el sistema, en Ajustes › Licencia. Cada clave se vincula al primer equipo donde la actives. Cualquier duda me escribes.'),
        ('plantilla_wa_cobro', 'Hola {cliente}, te recuerdo el saldo pendiente de {monto} por {producto} (venta {venta}). Apenas se confirme el pago se activan tus licencias. {enlace}'),
        ('plantilla_wa_renovacion', 'Hola {cliente}, te escribo de {agencia}. Tu licencia de {producto} vence el {vence}. ¿Coordinamos la renovación para que no pierdas acceso? {enlace}'),
        ('hora_recordatorio_caja', '20'),
        ('respaldos_conservar', '14'),
        ('dias_aviso_vencimiento', '30,7,1'),
        ('renovacion_automatica_dias', '7'),
        ('api_key_pedidos', ''),
        ('portal_activo', '1');
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE precios_historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES planes(id),
        precio_anterior REAL,
        precio_nuevo REAL NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        motivo TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_precios_historial_plan ON precios_historial(plan_id, id);
      INSERT OR IGNORE INTO ajustes (clave, valor) VALUES
        ('tope_descuento_admin_pct', '15'),
        ('niveles_precio', '[{"nombre":"Micro","mensual":7,"anual":59,"vitalicio":149},{"nombre":"Servicios simples","mensual":15,"anual":129,"vitalicio":299},{"nombre":"Negocio establecido","mensual":25,"anual":219,"vitalicio":499},{"nombre":"Profesional regulado","mensual":39,"anual":349,"vitalicio":790}]');
    `,
  },
  {
    version: 4,
    sql: `
      -- roles nuevos: soporte (tickets y licencias) y contador (caja, comisiones, exportación)
      CREATE TABLE usuarios_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        hash_clave TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('superadmin','admin','vendedor','revendedor','soporte','contador')),
        comision_pct REAL NOT NULL DEFAULT 20,
        tope_emisiones_dia INTEGER NOT NULL DEFAULT 20,
        tope_demos_semana INTEGER NOT NULL DEFAULT 10,
        telefono TEXT,
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        intentos_fallidos INTEGER NOT NULL DEFAULT 0,
        bloqueado_hasta TEXT,
        debe_cambiar_clave INTEGER NOT NULL DEFAULT 0,
        totp_secreto TEXT,
        totp_activo INTEGER NOT NULL DEFAULT 0,
        codigo_ref TEXT UNIQUE,
        cupo_licencias INTEGER,
        descuento_mayorista_pct REAL,
        marca_nombre TEXT,
        ultimo_acceso TEXT
      );
      INSERT INTO usuarios_v4 SELECT id, email, nombre, hash_clave, rol, comision_pct, tope_emisiones_dia, tope_demos_semana, telefono, activo, creado_en,
        intentos_fallidos, bloqueado_hasta, debe_cambiar_clave, totp_secreto, totp_activo, codigo_ref, cupo_licencias, descuento_mayorista_pct, marca_nombre, ultimo_acceso FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios_v4 RENAME TO usuarios;

      -- enlaces de pago: nuevos proveedores (culqi y futuros)
      CREATE TABLE enlaces_pago_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        proveedor TEXT NOT NULL,
        id_externo TEXT, url TEXT NOT NULL,
        monto REAL NOT NULL, moneda TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','cancelado','expirado')),
        datos TEXT, creado_por INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now')), pagado_en TEXT
      );
      INSERT INTO enlaces_pago_v4 SELECT id, venta_id, proveedor, id_externo, url, monto, moneda, estado, datos, creado_por, creado_en, pagado_en FROM enlaces_pago;
      DROP TABLE enlaces_pago;
      ALTER TABLE enlaces_pago_v4 RENAME TO enlaces_pago;

      -- cuotas
      ALTER TABLE planes ADD COLUMN cuotas INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE ventas ADD COLUMN cuotas INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE cuotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        numero INTEGER NOT NULL,
        monto REAL NOT NULL,
        vence_en TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','vencida')),
        pagada_en TEXT,
        UNIQUE (venta_id, numero)
      );

      -- mensajería (WhatsApp Cloud API, Telegram) y alertas al dueño
      CREATE TABLE mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canal TEXT NOT NULL CHECK (canal IN ('whatsapp','telegram')),
        para TEXT NOT NULL,
        texto TEXT NOT NULL,
        plantilla TEXT,
        referencia TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','error','sin_configurar')),
        error TEXT,
        id_externo TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        enviado_en TEXT
      );

      -- retención
      CREATE TABLE encuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        ticket_id INTEGER REFERENCES tickets(id),
        venta_id INTEGER REFERENCES ventas(id),
        producto_id INTEGER REFERENCES productos(id),
        motivo TEXT NOT NULL,
        puntaje INTEGER NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
        comentario TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- prospectos (leads)
      CREATE TABLE prospectos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        negocio TEXT,
        telefono TEXT,
        email TEXT,
        rubro TEXT,
        producto_id INTEGER REFERENCES productos(id),
        etapa TEXT NOT NULL DEFAULT 'nuevo' CHECK (etapa IN ('nuevo','contactado','demo','propuesta','ganado','perdido')),
        motivo_perdida TEXT,
        notas TEXT,
        vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
        cliente_id INTEGER REFERENCES clientes(id),
        origen TEXT,
        proximo_paso TEXT,
        proximo_paso_en TEXT,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- material de venta y versiones publicadas por producto
      ALTER TABLE productos ADD COLUMN material TEXT;
      CREATE TABLE versiones_producto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        version TEXT NOT NULL,
        notas TEXT,
        archivo TEXT,
        tamano INTEGER,
        sha256 TEXT,
        url_externa TEXT,
        publicada INTEGER NOT NULL DEFAULT 1,
        creado_por INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (producto_id, version)
      );

      -- facturación electrónica
      CREATE TABLE comprobantes_fiscales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        pago_id INTEGER REFERENCES pagos(id),
        proveedor TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('boleta','factura','nota_credito')),
        serie TEXT, numero TEXT,
        cliente_documento_tipo TEXT, cliente_documento TEXT, cliente_razon_social TEXT, cliente_direccion TEXT,
        moneda TEXT NOT NULL, total REAL NOT NULL, igv REAL NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptado','rechazado','anulado','error')),
        enlace_pdf TEXT, enlace_xml TEXT, hash TEXT, respuesta TEXT, error TEXT,
        creado_por INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE clientes ADD COLUMN documento_tipo TEXT;
      ALTER TABLE clientes ADD COLUMN documento TEXT;
      ALTER TABLE clientes ADD COLUMN razon_social TEXT;
      ALTER TABLE clientes ADD COLUMN direccion TEXT;

      INSERT OR IGNORE INTO ajustes (clave, valor) VALUES
        ('culqi_clave_publica', ''), ('culqi_clave_secreta', ''),
        ('whatsapp_token', ''), ('whatsapp_telefono_id', ''), ('whatsapp_modo', 'texto'),
        ('whatsapp_plantilla_cobro', ''), ('whatsapp_plantilla_vencimiento', ''), ('whatsapp_idioma', 'es'),
        ('telegram_token', ''), ('telegram_chat_id', ''),
        ('telefono_dueno', ''),
        ('alertas_dueno', 'pago_por_confirmar,activacion_rechazada,instalacion_clonada,cuota_vencida,ticket_nuevo,cierre_caja,planificador_detenido'),
        ('recordatorio_cobro_dias', '3'),
        ('cuotas_gracia_dias', '5'),
        ('facturacion_proveedor', 'ninguno'),
        ('nubefact_url', ''), ('nubefact_token', ''),
        ('empresa_ruc', ''), ('empresa_razon_social', ''), ('empresa_direccion', ''),
        ('serie_factura', 'F001'), ('serie_boleta', 'B001'), ('igv_pct', '18'), ('precios_incluyen_igv', '1'),
        ('facturar_automatico', '0'),
        ('demo_autoservicio', '1'),
        ('monitor_url', '');
    `,
  },
];

function migrar(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS _migraciones (
    version INTEGER PRIMARY KEY,
    aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const aplicadas = new Set(d.prepare('SELECT version FROM _migraciones').all().map((f) => f.version));
  d.exec('PRAGMA foreign_keys = OFF');
  for (const m of MIGRACIONES) {
    if (aplicadas.has(m.version)) continue;
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      d.prepare('INSERT INTO _migraciones (version) VALUES (?)').run(m.version);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
  d.exec('PRAGMA foreign_keys = ON');
}

/** Lee un ajuste (string). */
export function ajuste(clave, porDefecto = null) {
  const fila = obtenerDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave);
  return fila ? fila.valor : porDefecto;
}

export function ajusteNumero(clave, porDefecto = 0) {
  const v = ajuste(clave);
  return v === null || v === undefined || v === '' ? porDefecto : Number(v);
}

export function guardarAjuste(clave, valor) {
  obtenerDb()
    .prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, String(valor));
}

/** Fecha/hora en el formato que usa SQLite (UTC, 'YYYY-MM-DD HH:MM:SS'). */
export function ahoraSql(desplazamientoDias = 0) {
  const f = new Date(Date.now() + desplazamientoDias * 86400000);
  return f.toISOString().slice(0, 19).replace('T', ' ');
}

export function hoySql() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Zona horaria de la agencia. SQLite guarda todo en UTC; para agrupar "por día"
 * (caja, ventas de hoy, topes diarios) se aplica el desfase configurado
 * (p. ej. -5 para Lima/Bogotá, -4 para La Paz/Santiago).
 */
export function desfaseHoras() {
  const v = Number(ajuste('desfase_horario_horas', '-5'));
  return Number.isFinite(v) ? v : -5;
}

/** Modificador SQLite para convertir una columna UTC a hora local: date(col, modZona()). */
export function modZona() {
  const h = desfaseHoras();
  return `${h >= 0 ? '+' : ''}${h} hours`;
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de la agencia. */
export function hoyLocal() {
  return new Date(Date.now() + desfaseHoras() * 3600000).toISOString().slice(0, 10);
}
