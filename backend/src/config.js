import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  entorno: process.env.NODE_ENV || 'development',
  puerto: Number(process.env.PUERTO || 4100),
  jwtSecreto: process.env.JWT_SECRETO || 'cambia-este-secreto-en-produccion',
  jwtDuracion: process.env.JWT_DURACION || '12h',
  rutaBaseDatos:
    process.env.BASE_DATOS === ':memory:'
      ? ':memory:'
      : resolve(raiz, process.env.BASE_DATOS || 'datos/control.db'),
  origenesPermitidos: (process.env.ORIGENES || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  // Duración del token firmado que reciben los productos (días).
  tokenLicenciaDias: Number(process.env.TOKEN_LICENCIA_DIAS || 7),
};
