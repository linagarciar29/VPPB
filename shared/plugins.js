/* =====================================================================
   VOEG · plugins.js
   ---------------------------------------------------------------------
   AQUÍ CONECTAS TU PROPIO CÓDIGO (wavelet + IA).

   La app llama a estas dos funciones. Tienes 3 formas de usarlas:

   1) MODO SERVIDOR (recomendado si tu código es Python):
      Escribe la URL de tu servidor en "Ajustes" (o en la pantalla 4).
      La app hará:
        POST {URL}/wavelet      -> multipart: sensor.csv, od.webm, oi.webm, sesion.json
                                   responde: imagen PNG/JPG (la imagen wavelet)
        POST {URL}/diagnostico  -> multipart: imagen (png), sesion.json
                                   responde JSON: { diagnostico, canal, lado,
                                   confianza, probabilidades: {clase: p}, detalle }
      Ver /server/app.py: ya trae ese servidor listo, solo pega tus funciones.

   2) MODO JAVASCRIPT: reemplaza el cuerpo de wavelet() o diagnostico()
      con tu propio código (por ejemplo un modelo TensorFlow.js / ONNX web).

   3) MODO DEMO: si no hay servidor ni código propio, la app calcula una
      wavelet Morlet de demostración y un diagnóstico DEMO (no clínico).
   ===================================================================== */

window.VOEG_PLUGINS = {
  /**
   * @param {object} sesion  { paciente, camaras, sensor:[{t,yaw,pitch,roll}], archivos:{od,oi,xlsx} }
   * @param {object} opciones { senal: 'yaw'|'pitch'|'roll'|'todas' }
   * @returns {Promise<{imagen: Blob, info: string} | null>}  null = usar demo
   */
  async wavelet(sesion, opciones) {
    const url = VOEG_PLUGINS.servidor();
    if (!url) return null; // -> demo integrada
    const fd = new FormData();
    fd.append('sensor', new Blob([VOEG_PLUGINS.sensorCSV(sesion.sensor)], { type: 'text/csv' }), 'sensor.csv');
    if (sesion.archivos?.od) fd.append('od', sesion.archivos.od, 'od.webm');
    if (sesion.archivos?.oi) fd.append('oi', sesion.archivos.oi, 'oi.webm');
    fd.append('sesion', JSON.stringify({ ...sesion, archivos: undefined, sensor: undefined, opciones }));
    const r = await fetch(url + '/wavelet', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('El servidor respondió ' + r.status + ' en /wavelet');
    return { imagen: await r.blob(), info: 'Imagen generada por tu servidor (' + url + ')' };
  },

  /**
   * @param {Blob} imagen  imagen wavelet
   * @param {object} sesion
   * @returns {Promise<{diagnostico, canal, lado, confianza, probabilidades, detalle} | null>}
   */
  async diagnostico(imagen, sesion) {
    const url = VOEG_PLUGINS.servidor();
    if (!url) return null; // -> demo integrada
    const fd = new FormData();
    fd.append('imagen', imagen, 'wavelet.png');
    fd.append('sesion', JSON.stringify({ paciente: sesion.paciente, camaras: sesion.camaras }));
    const r = await fetch(url + '/diagnostico', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('El servidor respondió ' + r.status + ' en /diagnostico');
    return await r.json();
  },

  /* ---------- utilidades ---------- */
  servidor() {
    const u = (localStorage.getItem('voeg.servidor') || '').trim();
    return u ? u.replace(/\/+$/, '') : '';
  },
  sensorCSV(muestras = []) {
    return 't_ms,arduino_ms,yaw,pitch,roll\n' +
      muestras.map(m => [m.t.toFixed(1), m.ard ?? '', m.yaw, m.pitch, m.roll].join(',')).join('\n');
  }
};
