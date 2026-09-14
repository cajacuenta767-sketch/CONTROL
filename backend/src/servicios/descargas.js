import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obtenerDb, ajuste, guardarAjuste } from '../db.js';
import { dirDatos } from '../config.js';
import { ErrorHttp } from '../middleware/errores.js';
import { auditar } from './auditoria.js';

/**
 * Descargas de las apps (Android e instalador de Windows) para la landing pública /descargar.
 * Cada plataforma puede venir de un archivo subido al servidor o de una URL externa
 * (GitHub Releases). El archivo subido tiene prioridad.
 */
export const DIR_DESCARGAS = resolve(dirDatos(), 'descargas');
export const PLATAFORMAS = {
  android: { nombre: 'CONTROL-android.apk', tipo: 'application/vnd.android.package-archive', ext: ['.apk'] },
  windows: { nombre: 'CONTROL-Instalador.exe', tipo: 'application/x-msdownload', ext: ['.exe', '.msi'] },
  windows_portable: { nombre: 'CONTROL-Portable.exe', tipo: 'application/x-msdownload', ext: ['.exe', '.zip'] },
};
const urlPublica = () => ajuste('url_publica', 'http://localhost:5173').replace(/\/$/, '');

export function asegurarDirDescargas() { mkdirSync(DIR_DESCARGAS, { recursive: true }); return DIR_DESCARGAS; }

/** Estado público: qué hay disponible por plataforma. */
export function estadoDescargas() {
  const salida = { version: ajuste('descarga_version', '1.0.0'), agencia: ajuste('nombre_agencia', 'CONTROL'), url_panel: urlPublica(), plataformas: {} };
  for (const [clave, def] of Object.entries(PLATAFORMAS)) {
    const archivo = ajuste(`descarga_${clave}_archivo`, '');
    const ruta = archivo ? resolve(DIR_DESCARGAS, archivo) : null;
    const local = ruta && ruta.startsWith(DIR_DESCARGAS) && existsSync(ruta);
    const url = local ? `/api/v1/publico/descargas/${clave}` : ajuste(`descarga_${clave}_url`, '') || null;
    salida.plataformas[clave] = { disponible: Boolean(url), url, origen: local ? 'archivo' : url ? 'externa' : null, tamano: local ? statSync(ruta).size : null, nombre: def.nombre, actualizado_en: local ? statSync(ruta).mtime.toISOString() : null };
  }
  return salida;
}

export function registrarArchivo(plataforma, nombreArchivo, actor) {
  const def = PLATAFORMAS[plataforma];
  if (!def) throw new ErrorHttp(422, 'Plataforma desconocida');
  const ext = nombreArchivo.slice(nombreArchivo.lastIndexOf('.')).toLowerCase();
  if (!def.ext.includes(ext)) { try { unlinkSync(resolve(DIR_DESCARGAS, nombreArchivo)); } catch { /* nada */ } throw new ErrorHttp(422, `Para ${plataforma} se espera un archivo ${def.ext.join(' o ')}`); }
  const anterior = ajuste(`descarga_${plataforma}_archivo`, '');
  if (anterior && anterior !== nombreArchivo) { try { unlinkSync(resolve(DIR_DESCARGAS, anterior)); } catch { /* ya no está */ } }
  guardarAjuste(`descarga_${plataforma}_archivo`, nombreArchivo);
  auditar({ usuarioId: actor.id, accion: 'descargas.subir', detalle: { plataforma, archivo: nombreArchivo } });
  return estadoDescargas();
}

export function quitarArchivo(plataforma, actor) {
  const anterior = ajuste(`descarga_${plataforma}_archivo`, '');
  if (anterior) { try { unlinkSync(resolve(DIR_DESCARGAS, anterior)); } catch { /* nada */ } }
  guardarAjuste(`descarga_${plataforma}_archivo`, '');
  auditar({ usuarioId: actor.id, accion: 'descargas.quitar', detalle: { plataforma } });
  return estadoDescargas();
}

export function archivoDescarga(plataforma) {
  const def = PLATAFORMAS[plataforma];
  const archivo = ajuste(`descarga_${plataforma}_archivo`, '');
  if (!def || !archivo) throw new ErrorHttp(404, 'No hay archivo para esta plataforma');
  const ruta = resolve(DIR_DESCARGAS, archivo);
  if (!ruta.startsWith(DIR_DESCARGAS) || !existsSync(ruta)) throw new ErrorHttp(404, 'Archivo no encontrado');
  obtenerDb().prepare("INSERT INTO auditoria (accion, entidad, detalle) VALUES ('descargas.descarga', 'app', ?)").run(JSON.stringify({ plataforma }));
  return { ruta, nombre: def.nombre, tipo: def.tipo };
}
