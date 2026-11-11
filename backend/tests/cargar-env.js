// Carga backend/.env.test cuando existe (en local). En integración continua las variables ya vienen del flujo.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), quiet: true });
process.env.TZ = process.env.TZ || 'America/Guatemala'; // a propósito distinta de UTC: las pruebas deben pasar igual
