import { crearApp } from './app.js';
import { config } from './config.js';
import { obtenerDb } from './db.js';
import { obtenerClaves } from './firmas.js';

obtenerDb();
obtenerClaves();

const app = crearApp();
app.listen(config.puerto, () => {
  console.log(`CONTROL API escuchando en http://localhost:${config.puerto} (${config.entorno})`);
  console.log(`Base de datos: ${config.rutaBaseDatos}`);
});
