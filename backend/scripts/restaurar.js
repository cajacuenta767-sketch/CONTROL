/**
 * Restaura un respaldo sobre la base de datos activa.
 *   node scripts/restaurar.js datos/respaldos/control-2026-09-14T03-00-00.db
 * Detén la API antes de restaurar. La base actual se guarda como *.antes-de-restaurar.
 */
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { config } from '../src/config.js';

const origen = process.argv[2];
if (!origen || !existsSync(origen)) { console.error('Uso: node scripts/restaurar.js <archivo.db>'); process.exit(1); }
if (config.rutaBaseDatos === ':memory:') { console.error('BASE_DATOS es :memory:'); process.exit(1); }
const destino = config.rutaBaseDatos;
if (existsSync(destino)) renameSync(destino, `${destino}.antes-de-restaurar-${Date.now()}`);
for (const sufijo of ['-wal', '-shm']) { if (existsSync(destino + sufijo)) renameSync(destino + sufijo, `${destino}${sufijo}.antes-de-restaurar-${Date.now()}`); }
copyFileSync(origen, destino);
console.log(`Restaurado ${origen} → ${destino}. Arranca la API de nuevo.`);
