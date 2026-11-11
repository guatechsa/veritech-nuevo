// Se ejecuta UNA vez, en el proceso principal, antes de cualquier prueba. Aquí sí se puede fijar la zona horaria
// (dentro de las pruebas, process.env es una copia y cambiarlo no afecta a Node).
// A propósito SIEMPRE distinta de UTC: las pruebas de horas deben pasar igual que en el servidor real,
// donde Node corre en America/Guatemala.
module.exports = async () => {
  process.env.TZ = 'America/Guatemala';
};
