import { crearApp } from './app.js';
import { config } from './config.js';
import { obtenerDb } from './db.js';
import { obtenerClaves } from './firmas.js';

obtenerDb();
obtenerClaves();

if (config.entorno === 'production' && config.jwtSecreto === 'cambia-este-secreto-en-produccion') {
  console.error('ERROR: define JWT_SECRETO en backend/.env antes de arrancar en producción.');
  process.exit(1);
}

const app = crearApp();
app.listen(config.puerto, () => {
  console.log(`CONTROL API escuchando en http://localhost:${config.puerto} (${config.entorno})`);
  console.log(`Base de datos: ${config.rutaBaseDatos}`);
});
