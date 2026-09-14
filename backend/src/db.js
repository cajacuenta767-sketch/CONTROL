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
        ('metodos_en_mano', 'efectivo');
    `,
  },
];

function migrar(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS _migraciones (
    version INTEGER PRIMARY KEY,
    aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const aplicadas = new Set(d.prepare('SELECT version FROM _migraciones').all().map((f) => f.version));
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
