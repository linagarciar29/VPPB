/* =====================================================================
   VOEG · app.js  — lógica común a los dos diseños
   Pantallas: 1 Bienvenida · 2 Paciente · 3 Adquisición · 4 Wavelet · 5 Diagnóstico
   ===================================================================== */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '°';
  const pad = n => String(n).padStart(2, '0');

  /* ---------------- Estado de la sesión ---------------- */
  const S = {
    paciente: JSON.parse(localStorage.getItem('voeg.paciente') || 'null'),
    camaras: JSON.parse(localStorage.getItem('voeg.camaras') || '{"od":null,"oi":null}'),
    streams: { od: null, oi: null },
    rec: { od: null, oi: null }, chunks: { od: [], oi: [] },
    eventos: [], frames: { od: [], oi: [] },
    sensor: [], vivo: [], grabando: false, t0: 0, t0ISO: '',
    serial: { port: null, reader: null, writer: null, demo: null },
    archivos: {}, waveletBlob: null, diag: null
  };

  /* ---------------- Utilidades UI ---------------- */
  function toast(msg, tipo = 'info') {
    const t = $('#toast'); if (!t) return alert(msg);
    t.textContent = msg; t.dataset.tipo = tipo; t.classList.add('show');
    clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 3600);
  }
  function estado(el, txt, ok) { const e = $(el); if (!e) return; e.textContent = txt; e.dataset.ok = ok ? '1' : ok === false ? '0' : ''; }

  /* ---------------- Navegación ---------------- */
  let actual = 1;
  function ir(n) {
    n = Math.max(1, Math.min(5, +n));
    if (n >= 3 && !S.paciente) { toast('Primero registra los datos del paciente.', 'warn'); n = 2; }
    actual = n;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's' + n));
    $$('[data-goto]').forEach(b => {
      const k = +b.dataset.goto;
      b.classList.toggle('active', k === n);
      b.classList.toggle('done', k < n);
    });
    document.documentElement.dataset.step = n;
    if (n === 3) { pintarMini(); dimensionarGrafica(); }
    if (n === 5) prepararDiag();
    history.replaceState(null, '', '#' + n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-goto]'); if (b) { e.preventDefault(); ir(b.dataset.goto); }
  });

  /* ---------------- Pantalla 2: Paciente ---------------- */
  function initPaciente() {
    const f = $('#patientForm'); if (!f) return;
    const fn = f.elements.nacimiento, edad = f.elements.edad;
    if (f.elements.fechaExamen && !f.elements.fechaExamen.value) {
      const d = new Date(); f.elements.fechaExamen.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    fn?.addEventListener('change', () => {
      if (!fn.value) return; const b = new Date(fn.value), h = new Date();
      let a = h.getFullYear() - b.getFullYear(); if (h < new Date(h.getFullYear(), b.getMonth(), b.getDate())) a--;
      edad.value = a >= 0 ? a : '';
    });
    if (S.paciente) for (const [k, v] of Object.entries(S.paciente)) {
      const el = f.elements[k]; if (!el) continue;
      if (el instanceof RadioNodeList || el.length > 1 && el[0]?.type === 'checkbox') {
        [...(el.length ? el : [el])].forEach(x => { if (x.type === 'checkbox') x.checked = [].concat(v).includes(x.value); else if (x.type === 'radio') x.checked = x.value === v; });
      } else if (el.type === 'checkbox') el.checked = [].concat(v).includes(el.value);
      else el.value = v;
    }
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      const fd = new FormData(f), p = {};
      for (const [k, v] of fd.entries()) p[k] = p[k] !== undefined ? [].concat(p[k], v) : v;
      if (!p.consentimiento) { toast('Falta el consentimiento informado.', 'warn'); return; }
      p.idSesion = 'VOEG-' + (p.identificacion || 'SINID').replace(/\W+/g, '') + '-' + Date.now().toString(36).toUpperCase();
      S.paciente = p; localStorage.setItem('voeg.paciente', JSON.stringify(p));
      toast('Paciente guardado: ' + p.nombre + ' ' + (p.apellidos || ''), 'ok');
      ir(3);
    });
    $('#btnLimpiar')?.addEventListener('click', () => { f.reset(); S.paciente = null; localStorage.removeItem('voeg.paciente'); toast('Formulario limpio.'); });
  }
  function pintarMini() {
    const p = S.paciente; if (!p) return;
    $$('.pacienteMini').forEach(el => el.innerHTML =
      '<strong>' + esc(p.nombre + ' ' + (p.apellidos || '')) + '</strong><span>ID ' + esc(p.identificacion || '—') + ' · ' + esc(p.edad ? p.edad + ' años' : '') + ' · ' + esc(p.sexo || '') + '</span>');
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- Pantalla 3: Cámaras ---------------- */
  async function listarCamaras() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite cámaras (usa Chrome/Edge en https o localhost).');
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // pide permiso para ver nombres
    tmp.getTracks().forEach(t => t.stop());
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    for (const lado of ['od', 'oi']) {
      const sel = $('#cam' + lado.toUpperCase()); if (!sel) continue;
      sel.innerHTML = '<option value="">— Selecciona cámara —</option>' + devs.map((d, i) =>
        '<option value="' + d.deviceId + '">' + esc(d.label || 'Cámara ' + (i + 1)) + '</option>').join('');
      const guardada = S.camaras[lado]?.deviceId;
      if (guardada && devs.some(d => d.deviceId === guardada)) sel.value = guardada;
      else if (devs[lado === 'od' ? 0 : 1]) sel.value = devs[lado === 'od' ? 0 : 1].deviceId;
    }
    return devs;
  }
  async function abrirCamara(lado) {
    const sel = $('#cam' + lado.toUpperCase()), id = sel?.value;
    S.streams[lado]?.getTracks().forEach(t => t.stop()); S.streams[lado] = null;
    const v = $('#video' + lado.toUpperCase());
    if (!id) { if (v) v.srcObject = null; mostrarId(lado, null); return; }
    const fps = +($('#fps')?.value || 30);
    const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: id }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: fps } } });
    S.streams[lado] = st; if (v) { v.srcObject = st; v.play().catch(() => {}); }
    const tr = st.getVideoTracks()[0], set = tr.getSettings();
    S.camaras[lado] = { deviceId: id, etiqueta: tr.label, ancho: set.width, alto: set.height, fps: set.frameRate };
    localStorage.setItem('voeg.camaras', JSON.stringify(S.camaras));
    mostrarId(lado, S.camaras[lado]);
  }
  function mostrarId(lado, c) {
    const el = $('#id' + lado.toUpperCase()); if (!el) return;
    el.innerHTML = c ? '<b>' + esc(c.etiqueta) + '</b><code title="' + esc(c.deviceId) + '">ID ' + esc(c.deviceId.slice(0, 12)) + '…</code><small>' + (c.ancho || '?') + '×' + (c.alto || '?') + ' · ' + Math.round(c.fps || 0) + ' fps</small>' : '<small>Sin cámara</small>';
    el.closest('.cam')?.classList.toggle('on', !!c);
  }
  async function intercambiar() {
    const a = $('#camOD').value; $('#camOD').value = $('#camOI').value; $('#camOI').value = a;
    await abrirCamara('od'); await abrirCamara('oi'); toast('Cámaras intercambiadas: OD ↔ OI');
  }

  /* ---------------- Pantalla 3: Sensor (Web Serial) ----------------
     Formato esperado desde Arduino, una línea por muestra:
       yaw,pitch,roll                 (ej. "12.5,-3.2,0.8")
       millis,yaw,pitch,roll          (opcional, con el tiempo del Arduino)
     La app envía "START\n" al iniciar y "STOP\n" al finalizar (opcional en tu sketch). */
  async function conectarSensor() {
    if (S.serial.port || S.serial.demo) return true;
    if (!('serial' in navigator)) { toast('Web Serial no disponible: usa Chrome o Edge de escritorio. Puedes usar el modo demo.', 'warn'); return false; }
    const baud = +($('#baud')?.value || 115200);
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: baud });
    S.serial.port = port;
    S.serial.writer = port.writable?.getWriter();
    estado('#statusSensor', 'Sensor conectado · ' + baud + ' baud', true);
    leerSerial();
    return true;
  }
  async function leerSerial() {
    const dec = new TextDecoderStream(); S.serial.port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader(); S.serial.reader = reader; let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += value; let i;
        while ((i = buf.indexOf('\n')) >= 0) { procesarLinea(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
    } catch (e) { estado('#statusSensor', 'Sensor desconectado', false); }
  }
  function procesarLinea(l) {
    const n = l.trim().split(/[,;\s\t]+/).map(Number).filter(x => !isNaN(x));
    if (n.length < 3) return;
    const [ard, yaw, pitch, roll] = n.length >= 4 ? n : [null, ...n];
    muestra(yaw, pitch, roll, ard);
  }
  function muestra(yaw, pitch, roll, ard = null) {
    const ahora = performance.now();
    const m = { t: S.grabando ? ahora - S.t0 : 0, ard, yaw, pitch, roll, abs: ahora };
    S.vivo.push(m); while (S.vivo.length && ahora - S.vivo[0].abs > 10000) S.vivo.shift();
    if (S.grabando) S.sensor.push(m);
    $('#yawVal') && ($('#yawVal').textContent = fmt(yaw));
    $('#pitchVal') && ($('#pitchVal').textContent = fmt(pitch));
    $('#rollVal') && ($('#rollVal').textContent = fmt(roll));
    actualizarCabeza(yaw, pitch, roll);
  }
  function iniciarDemo() {
    if (S.serial.port) return;
    if (S.serial.demo) { clearInterval(S.serial.demo); S.serial.demo = null; estado('#statusSensor', 'Sensor sin conectar', null); $('#btnDemo')?.classList.remove('on'); return; }
    const t0 = performance.now();
    S.serial.demo = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      // Simula una maniobra tipo Dix-Hallpike: giro 45° + inclinación -30°
      const fase = Math.min(1, Math.max(0, (t % 16 - 2) / 1.5)), vuelta = Math.min(1, Math.max(0, (t % 16 - 11) / 1.5));
      const k = fase - vuelta;
      muestra(45 * k + Math.sin(t * 7) * .6, -30 * k + Math.sin(t * 5.3) * .8, 4 * Math.sin(t * .8) + Math.sin(t * 9) * .4, Math.round(t * 1000));
    }, 20);
    $('#btnDemo')?.classList.add('on');
    estado('#statusSensor', 'Modo demo · 50 Hz simulado', true);
  }
  function enviarSerial(txt) { try { S.serial.writer?.write(new TextEncoder().encode(txt)); } catch (_) {} }

  /* Cabeza 3D simple (si el diseño la incluye) */
  function actualizarCabeza(y, p, r) {
    const h = $('#head3d'); if (h) h.style.transform = 'rotateY(' + y + 'deg) rotateX(' + (-p) + 'deg) rotateZ(' + r + 'deg)';
  }

  /* ---------------- Gráfica en vivo (canvas, sin librerías) ---------------- */
  const cv = () => $('#angleChart');
  function dimensionarGrafica() {
    const c = cv(); if (!c) return; const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
    c.width = Math.max(300, r.width) * d; c.height = Math.max(160, r.height) * d;
  }
  function dibujar() {
    const c = cv();
    if (c && actual === 3) {
      const ctx = c.getContext('2d'), d = devicePixelRatio || 1, W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);
      const pl = 38 * d, pr = 10 * d, pt = 10 * d, pb = 22 * d, w = W - pl - pr, h = H - pt - pb;
      const rango = 90, y = v => pt + h / 2 - (v / rango) * (h / 2);
      ctx.font = 11 * d + 'px ' + (css('--font-mono') || 'monospace'); ctx.fillStyle = css('--muted') || '#889';
      ctx.strokeStyle = css('--grid') || 'rgba(127,140,160,.2)'; ctx.lineWidth = 1 * d;
      for (const g of [-90, -45, 0, 45, 90]) { ctx.beginPath(); ctx.moveTo(pl, y(g)); ctx.lineTo(W - pr, y(g)); ctx.stroke(); ctx.fillText((g > 0 ? '+' : '') + g + '°', 2 * d, y(g) + 4 * d); }
      for (let s = 0; s <= 10; s += 2) { const x = pl + w * (s / 10); ctx.fillText('-' + (10 - s) + 's', x - 10 * d, H - 6 * d); }
      const ahora = performance.now(), series = [['yaw', css('--c-yaw') || '#4a90c2'], ['pitch', css('--c-pitch') || '#d98c5f'], ['roll', css('--c-roll') || '#7fb8a4']];
      for (const [k, col] of series) {
        ctx.strokeStyle = col; ctx.lineWidth = 2 * d; ctx.lineJoin = 'round'; ctx.beginPath(); let first = true;
        for (const m of S.vivo) { const x = pl + w * (1 - (ahora - m.abs) / 10000), yy = y(Math.max(-rango, Math.min(rango, m[k]))); first ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); first = false; }
        ctx.stroke();
      }
    }
    if (S.grabando) { const s = (performance.now() - S.t0) / 1000; $('#recTimer') && ($('#recTimer').textContent = pad(Math.floor(s / 60)) + ':' + pad(Math.floor(s % 60)) + '.' + Math.floor(s * 10 % 10)); }
    requestAnimationFrame(dibujar);
  }

  /* ---------------- Botón CONECTAR (cámaras + sensor) ---------------- */
  async function conectarTodo() {
    const btn = $('#btnConectar'); btn && (btn.disabled = true);
    try {
      estado('#statusCams', 'Buscando cámaras…');
      const devs = await listarCamaras();
      await abrirCamara('od'); await abrirCamara('oi');
      estado('#statusCams', devs.length + ' cámara(s) detectada(s)', devs.length >= 2 ? true : null);
      if (devs.length < 2) toast('Solo se detectó ' + devs.length + ' cámara. Se necesitan 2 (OD y OI).', 'warn');
    } catch (e) { estado('#statusCams', 'Error de cámaras', false); toast(e.message, 'err'); }
    try { if (!S.serial.demo) await conectarSensor(); } catch (e) { if (e.name !== 'NotFoundError') toast('Sensor: ' + e.message, 'err'); else toast('No elegiste puerto del sensor. Puedes usar el modo demo.', 'warn'); }
    btn && (btn.disabled = false); listo();
  }
  function listo() {
    const ok = !!(S.streams.od || S.streams.oi) || !!(S.serial.port || S.serial.demo);
    $('#btnIniciar') && ($('#btnIniciar').disabled = !ok || S.grabando);
  }

  /* ---------------- INICIAR: arranque sincronizado ---------------- */
  function mime() { return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => window.MediaRecorder?.isTypeSupported?.(m)) || ''; }
  function iniciar() {
    if (S.grabando) return;
    S.sensor = []; S.eventos = []; S.frames = { od: [], oi: [] }; S.chunks = { od: [], oi: [] }; S.archivos = {};
    const tipo = mime();
    // 1) Se preparan ambos grabadores ANTES de fijar t0
    for (const l of ['od', 'oi']) {
      if (!S.streams[l]) continue;
      const r = new MediaRecorder(S.streams[l], tipo ? { mimeType: tipo, videoBitsPerSecond: 4e6 } : undefined);
      r.ondataavailable = e => e.data.size && S.chunks[l].push(e.data);
      r.onstart = () => S.eventos.push({ evento: 'inicio_grabacion_' + l.toUpperCase(), t: performance.now() - S.t0 });
      r.onstop = () => S.eventos.push({ evento: 'fin_grabacion_' + l.toUpperCase(), t: performance.now() - S.t0 });
      S.rec[l] = r;
    }
    // 2) t0 común: cámaras, sensor y Excel comparten este reloj (performance.now, precisión sub‑ms)
    S.t0 = performance.now(); S.t0ISO = new Date(performance.timeOrigin + S.t0).toISOString();
    S.grabando = true;
    enviarSerial('START\n');
    S.eventos.push({ evento: 't0_comun', t: 0 });
    for (const l of ['od', 'oi']) if (S.rec[l]) { S.rec[l].start(1000); marcarFrames(l); }
    S.eventos.push({ evento: 'inicio_sensor', t: performance.now() - S.t0 });
    document.documentElement.classList.add('recording');
    $('#btnIniciar').disabled = true; $('#btnFinalizar').disabled = false;
    toast('Grabando · cámaras y sensor sincronizados', 'ok');
  }
  function marcarFrames(l) { // registra el tiempo de cada cuadro de video
    const v = $('#video' + l.toUpperCase()); if (!v?.requestVideoFrameCallback) return;
    const cb = (now, meta) => { if (!S.grabando) return; S.frames[l].push({ n: meta.presentedFrames, t: now - S.t0, media: meta.mediaTime }); v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  }

  /* ---------------- FINALIZAR y GUARDAR ---------------- */
  async function finalizar() {
    if (!S.grabando) return;
    const tFin = performance.now() - S.t0;
    const paradas = ['od', 'oi'].filter(l => S.rec[l]?.state === 'recording').map(l => new Promise(res => { S.rec[l].addEventListener('stop', res, { once: true }); S.rec[l].stop(); }));
    S.grabando = false; enviarSerial('STOP\n');
    S.eventos.push({ evento: 'fin_sensor', t: tFin });
    await Promise.all(paradas);
    document.documentElement.classList.remove('recording');
    $('#btnFinalizar').disabled = true; listo();
    const tipo = (mime().split(';')[0] || 'video/webm'), ext = tipo.includes('mp4') ? 'mp4' : 'webm';
    const base = S.paciente.idSesion + '_' + S.t0ISO.slice(0, 19).replace(/[:T]/g, '-');
    const files = [];
    for (const l of ['od', 'oi']) if (S.chunks[l].length) { S.archivos[l] = new Blob(S.chunks[l], { type: tipo }); files.push([base + '_' + l.toUpperCase() + '.' + ext, S.archivos[l]]); }
    S.archivos.xlsx = excelTiempos(tFin); files.push([base + '_tiempos.xlsx', S.archivos.xlsx]);
    files.push([base + '_sesion.json', new Blob([JSON.stringify({ paciente: S.paciente, camaras: S.camaras, inicio: S.t0ISO, duracion_ms: tFin, eventos: S.eventos, muestras_sensor: S.sensor.length }, null, 2)], { type: 'application/json' })]);
    await guardarArchivos(files, base);
    $('#fileList') && ($('#fileList').innerHTML = files.map(([n, b]) => '<li><span>' + esc(n) + '</span><em>' + (b.size / 1024 > 1024 ? (b.size / 1048576).toFixed(1) + ' MB' : Math.ceil(b.size / 1024) + ' KB') + '</em></li>').join(''));
    $('#btnASiguiente') && ($('#btnASiguiente').disabled = false);
    toast('Sesión guardada: ' + files.length + ' archivos', 'ok');
  }
  function excelTiempos(tFin) {
    const p = S.paciente, c = S.camaras, r = v => Math.round(v * 100) / 100;
    const ini = l => S.eventos.find(e => e.evento === 'inicio_grabacion_' + l)?.t;
    const desfase = (ini('OD') !== undefined && ini('OI') !== undefined) ? Math.abs(ini('OD') - ini('OI')) : '';
    return XLSXLite.libro([
      { nombre: 'Resumen', filas: [
        ['Campo', 'Valor'], ['Sesión', p.idSesion], ['Paciente', p.nombre + ' ' + (p.apellidos || '')], ['Identificación', p.identificacion || ''],
        ['Inicio (ISO, t0 común)', S.t0ISO], ['Duración (ms)', r(tFin)],
        ['Cámara OD · etiqueta', c.od?.etiqueta || ''], ['Cámara OD · deviceId', c.od?.deviceId || ''], ['Cámara OD · fps', c.od?.fps || ''],
        ['Cámara OI · etiqueta', c.oi?.etiqueta || ''], ['Cámara OI · deviceId', c.oi?.deviceId || ''], ['Cámara OI · fps', c.oi?.fps || ''],
        ['Desfase inicio OD vs OI (ms)', desfase === '' ? '' : r(desfase)],
        ['Muestras sensor', S.sensor.length], ['Frecuencia sensor (Hz)', S.sensor.length > 1 ? r(S.sensor.length / (tFin / 1000)) : ''],
        ['Cuadros OD registrados', S.frames.od.length], ['Cuadros OI registrados', S.frames.oi.length]] },
      { nombre: 'Eventos', filas: [['Evento', 't desde t0 (ms)'], ...S.eventos.map(e => [e.evento, r(e.t)])] },
      { nombre: 'Sensor', filas: [['t (ms)', 't Arduino (ms)', 'Yaw (°)', 'Pitch (°)', 'Roll (°)'], ...S.sensor.map(m => [r(m.t), m.ard ?? '', r(m.yaw), r(m.pitch), r(m.roll)])] },
      { nombre: 'Cuadros_OD', filas: [['Cuadro', 't (ms)', 'Tiempo de medio (s)'], ...S.frames.od.map(f => [f.n, r(f.t), r(f.media)])] },
      { nombre: 'Cuadros_OI', filas: [['Cuadro', 't (ms)', 'Tiempo de medio (s)'], ...S.frames.oi.map(f => [f.n, r(f.t), r(f.media)])] }
    ]);
  }
  let carpeta = null;
  async function guardarArchivos(files, base) {
    if (window.showDirectoryPicker) {
      try {
        carpeta = carpeta || await showDirectoryPicker({ id: 'voeg', mode: 'readwrite' });
        const sub = await carpeta.getDirectoryHandle(base, { create: true });
        for (const [n, b] of files) { const fh = await sub.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(b); await w.close(); }
        return;
      } catch (e) { if (e.name === 'AbortError') toast('No elegiste carpeta: se descargarán los archivos.', 'warn'); }
    }
    for (const [n, b] of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); await new Promise(r => setTimeout(r, 350)); }
  }

  /* ---------------- Pantalla 4: Wavelet ---------------- */
  function cwtMorlet(x, escalas, w0 = 6) { // CWT Morlet directa (demo)
    const N = x.length, out = [];
    for (const s of escalas) {
      const half = Math.min(N, Math.ceil(4 * s)), fila = new Float32Array(N);
      for (let n = 0; n < N; n++) {
        let re = 0, im = 0;
        for (let k = -half; k <= half; k++) { let i = n + k; if (i < 0) i = -i; if (i >= N) i = 2 * N - 2 - i; if (i < 0 || i >= N) continue; const u = k / s, g = Math.exp(-u * u / 2); re += x[i] * g * Math.cos(w0 * u); im -= x[i] * g * Math.sin(w0 * u); }
        fila[n] = Math.sqrt(re * re + im * im) / Math.sqrt(s);
      }
      out.push(fila);
    }
    return out;
  }
  function senalDemo() {
    if (S.sensor.length > 32) return S.sensor;
    const out = []; for (let i = 0; i < 1500; i++) { const t = i * 20, k = Math.min(1, Math.max(0, (t - 3000) / 1500)) - Math.min(1, Math.max(0, (t - 22000) / 1500)); out.push({ t, yaw: 45 * k + Math.sin(i * .9) * 1.5 * k, pitch: -30 * k + Math.sin(i * .55) * 3 * k * Math.exp(-(((t - 8000) / 4000) ** 2)), roll: Math.sin(i * .02) * 3 }); }
    return out;
  }
  async function procesarWavelet() {
    const btn = $('#btnWavelet'); btn.disabled = true; btn.classList.add('loading');
    const senal = $('#signalSel')?.value || 'pitch';
    try {
      const sesion = { paciente: S.paciente, camaras: S.camaras, sensor: S.sensor, archivos: S.archivos };
      const ext = await window.VOEG_PLUGINS?.wavelet?.(sesion, { senal });
      if (ext?.imagen) { S.waveletBlob = ext.imagen; mostrarImagenWavelet(URL.createObjectURL(ext.imagen)); $('#waveletInfo').textContent = ext.info || 'Imagen wavelet lista.'; }
      else {
        await new Promise(r => setTimeout(r, 30));
        const datos = senalDemo(), N = 512, T = datos[datos.length - 1].t - datos[0].t;
        const x = new Float32Array(N); let j = 0;
        for (let n = 0; n < N; n++) { const tt = datos[0].t + T * n / (N - 1); while (j < datos.length - 2 && datos[j + 1].t < tt) j++; const a = datos[j], b = datos[j + 1] || a, f = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0; x[n] = a[senal] + (b[senal] - a[senal]) * f; }
        const media = x.reduce((a, b) => a + b, 0) / N; for (let n = 0; n < N; n++) x[n] -= media;
        const escalas = Array.from({ length: 64 }, (_, i) => 1.5 * Math.pow(1.06, i));
        const W = cwtMorlet(x, escalas);
        dibujarEscalograma(W);
        S.waveletBlob = await new Promise(r => $('#scalogram').toBlob(r, 'image/png'));
        $('#waveletInfo').textContent = (S.sensor.length > 32 ? 'Señal real · ' + S.sensor.length + ' muestras' : 'Señal de ejemplo (aún no hay grabación)') + ' · ' + senal + ' · Morlet ω₀=6 · 64 escalas · DEMO: conecta tu código en plugins.js';
      }
      $('#btnADiag') && ($('#btnADiag').disabled = false);
      $('#s4')?.classList.add('has-result');
      toast('Wavelet lista', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false; btn.classList.remove('loading');
  }
  function mapaColor(v) {
    const stops = [0, 1, 2, 3, 4].map(i => css('--cm-' + i) || ['#0f1a2b', '#24476b', '#4f86b0', '#a8cfe0', '#f2e6c9'][i]).map(h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; });
    const p = Math.max(0, Math.min(.9999, v)) * 4, i = Math.floor(p), f = p - i;
    return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
  }
  function dibujarEscalograma(W) {
    const c = $('#scalogram'), S_ = W.length, N = W[0].length; c.width = N; c.height = S_ * 4;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, S_);
    let max = 0; for (const f of W) for (const v of f) max = Math.max(max, v);
    const rmax = W.map(f => Math.max(...f) * .85 + max * .15); // normalización por escala: realza detalle fino
    const lut = Array.from({ length: 256 }, (_, i) => mapaColor(i / 255));
    for (let s = 0; s < S_; s++) for (let n = 0; n < N; n++) { const [r, g, b] = lut[Math.min(255, Math.round(Math.sqrt(W[s][n] / rmax[s]) * 255))]; const o = ((S_ - 1 - s) * N + n) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; }
    const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = S_; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, N, S_ * 4);
    c.style.display = 'block'; $('#waveletImg') && ($('#waveletImg').style.display = 'none');
  }
  function mostrarImagenWavelet(url) { const i = $('#waveletImg'); if (i) { i.src = url; i.style.display = 'block'; } $('#scalogram') && ($('#scalogram').style.display = 'none'); }

  /* ---------------- Pantalla 5: Diagnóstico ---------------- */
  function prepararDiag() {
    const i = $('#diagImg'); if (!i) return;
    if (S.waveletBlob) { i.src = URL.createObjectURL(S.waveletBlob); i.parentElement.classList.add('has-img'); }
    pintarMini();
  }
  async function diagnosticar() {
    if (!S.waveletBlob) { toast('Primero genera o sube una imagen wavelet (pantalla 4).', 'warn'); return; }
    const btn = $('#btnDiagnosticar'); btn.disabled = true; btn.classList.add('loading'); $('#s5')?.classList.add('analizando');
    try {
      let r = await window.VOEG_PLUGINS?.diagnostico?.(S.waveletBlob, { paciente: S.paciente, camaras: S.camaras });
      if (!r) { // DEMO, no clínico
        await new Promise(res => setTimeout(res, 1400));
        const buf = new Uint8Array(await S.waveletBlob.slice(0, 4096).arrayBuffer()); let h = 0; for (const b of buf) h = (h * 31 + b) >>> 0;
        const clases = ['VPPB canal posterior derecho', 'VPPB canal posterior izquierdo', 'VPPB canal horizontal', 'VPPB canal anterior', 'Sin VPPB'];
        const raw = clases.map((_, i) => ((h >> (i * 5)) & 31) + 4); const top = h % 5; raw[top] += 60; const sum = raw.reduce((a, b) => a + b, 0);
        const probabilidades = Object.fromEntries(clases.map((c, i) => [c, raw[i] / sum]));
        r = { diagnostico: clases[top], confianza: raw[top] / sum, probabilidades, demo: true, detalle: 'Resultado de DEMOSTRACIÓN. No tiene validez clínica: conecta tu arquitectura de IA en plugins.js o en el servidor.' };
      }
      S.diag = r; pintarDiag(r);
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false; btn.classList.remove('loading'); $('#s5')?.classList.remove('analizando');
  }
  function pintarDiag(r) {
    const box = $('#diagResult'); if (!box) return;
    const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
    const probs = Object.entries(r.probabilidades || {}).sort((a, b) => b[1] - a[1]);
    box.innerHTML =
      (r.demo ? '<div class="demo-tag">MODO DEMO · sin validez clínica</div>' : '') +
      '<div class="dx-head"><span class="dx-label">Resultado del modelo</span><h3>' + esc(r.diagnostico) + '</h3>' +
      '<div class="dx-meta">' + (r.canal ? '<span>Canal: ' + esc(r.canal) + '</span>' : '') + (r.lado ? '<span>Lado: ' + esc(r.lado) + '</span>' : '') + '<span>Confianza: <b>' + pct(r.confianza) + '</b></span></div></div>' +
      '<div class="dx-ring" style="--p:' + Math.round((r.confianza || 0) * 100) + '"><span>' + pct(r.confianza) + '</span></div>' +
      (probs.length ? '<ul class="dx-bars">' + probs.map(([k, v]) => '<li><span>' + esc(k) + '</span><i style="--w:' + (v * 100).toFixed(1) + '%"></i><b>' + pct(v) + '</b></li>').join('') + '</ul>' : '') +
      (r.detalle ? '<p class="dx-note">' + esc(r.detalle) + '</p>' : '');
    box.classList.add('show');
    $('#btnReporte') && ($('#btnReporte').disabled = false);
  }
  function reporte() {
    const p = S.paciente || {}, d = S.diag || {}, img = S.waveletBlob ? URL.createObjectURL(S.waveletBlob) : '';
    const w = window.open('', '_blank'); if (!w) { toast('Permite ventanas emergentes para el reporte.', 'warn'); return; }
    const fila = (k, v) => '<tr><th>' + k + '</th><td>' + esc(v || '—') + '</td></tr>';
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte VOEG · ' + esc(p.idSesion) + '</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#1d2733;max-width:780px;margin:32px auto;padding:0 24px}h1{color:#3b5f7d;margin:0}h2{font-size:15px;color:#3b5f7d;border-bottom:2px solid #c9d6e0;padding-bottom:4px;margin-top:28px}table{width:100%;border-collapse:collapse}th{text-align:left;width:38%;color:#5d6d7e;font-weight:500}th,td{padding:5px 0;border-bottom:1px solid #eef2f5}img{max-width:100%;border-radius:8px;margin-top:8px}.dx{font-size:20px;font-weight:700}.demo{background:#fde9d9;color:#9a4b16;padding:6px 10px;border-radius:6px;display:inline-block;margin-top:8px}.firma{margin-top:60px;border-top:1px solid #333;width:280px;padding-top:6px}</style></head><body>' +
      '<h1>VOEG</h1><div>Reporte de evaluación vestibular · VPPB</div><div style="color:#7a8896">Sesión ' + esc(p.idSesion) + ' · ' + new Date().toLocaleString('es-MX') + '</div>' +
      '<h2>Paciente</h2><table>' + fila('Nombre', (p.nombre || '') + ' ' + (p.apellidos || '')) + fila('Identificación', p.identificacion) + fila('Fecha de nacimiento / edad', (p.nacimiento || '') + (p.edad ? ' · ' + p.edad + ' años' : '')) + fila('Sexo', p.sexo) + fila('Médico', p.medico) + fila('Institución', p.institucion) + fila('Motivo', p.motivo) + fila('Síntomas', [].concat(p.sintomas || []).join(', ')) + fila('Lado sospechado', p.ladoSospechado) + '</table>' +
      '<h2>Adquisición</h2><table>' + fila('Cámara ojo derecho (OD)', (S.camaras.od?.etiqueta || '') + ' · ' + (S.camaras.od?.deviceId || '')) + fila('Cámara ojo izquierdo (OI)', (S.camaras.oi?.etiqueta || '') + ' · ' + (S.camaras.oi?.deviceId || '')) + fila('Inicio', S.t0ISO) + fila('Muestras del sensor', String(S.sensor.length)) + '</table>' +
      '<h2>Imagen wavelet</h2>' + (img ? '<img src="' + img + '">' : '—') +
      '<h2>Diagnóstico</h2><div class="dx">' + esc(d.diagnostico || 'Pendiente') + '</div>' + (d.confianza != null ? '<div>Confianza: ' + Math.round(d.confianza * 100) + '%</div>' : '') + (d.demo ? '<div class="demo">Resultado de demostración, sin validez clínica.</div>' : '') +
      '<div class="firma">Firma del médico responsable</div><script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>');
    w.document.close();
  }
  function nuevaSesion() {
    if (!confirm('¿Iniciar una nueva evaluación? Se limpiarán los datos de esta sesión.')) return;
    localStorage.removeItem('voeg.paciente'); location.hash = '#1'; location.reload();
  }

  /* ---------------- Arranque ---------------- */
  function init() {
    initPaciente();
    $('#btnContinuar')?.addEventListener('click', () => ir(2));
    $('#btnConectar')?.addEventListener('click', conectarTodo);
    $('#btnDemo')?.addEventListener('click', () => { iniciarDemo(); listo(); });
    $('#btnSwap')?.addEventListener('click', intercambiar);
    $('#camOD')?.addEventListener('change', () => abrirCamara('od').catch(e => toast(e.message, 'err')));
    $('#camOI')?.addEventListener('change', () => abrirCamara('oi').catch(e => toast(e.message, 'err')));
    $('#btnIniciar')?.addEventListener('click', iniciar);
    $('#btnFinalizar')?.addEventListener('click', () => finalizar().catch(e => toast(e.message, 'err')));
    $('#btnWavelet')?.addEventListener('click', procesarWavelet);
    $('#waveletUpload')?.addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.waveletBlob = f; mostrarImagenWavelet(URL.createObjectURL(f)); $('#waveletInfo').textContent = 'Imagen cargada: ' + f.name; $('#btnADiag') && ($('#btnADiag').disabled = false); $('#s4')?.classList.add('has-result'); });
    $('#diagUpload')?.addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; S.waveletBlob = f; prepararDiag(); });
    $('#btnDiagnosticar')?.addEventListener('click', diagnosticar);
    $('#btnReporte')?.addEventListener('click', reporte);
    $('#btnNueva')?.addEventListener('click', nuevaSesion);
    const srv = $('#servidorURL'); if (srv) { srv.value = localStorage.getItem('voeg.servidor') || ''; srv.addEventListener('change', () => { localStorage.setItem('voeg.servidor', srv.value.trim()); toast(srv.value.trim() ? 'Servidor guardado' : 'Usando modo demo'); }); }
    $('#btnTema')?.addEventListener('click', () => document.documentElement.classList.toggle('alt'));
    addEventListener('resize', dimensionarGrafica);
    if (S.camaras.od) mostrarId('od', null);
    requestAnimationFrame(dibujar);
    ir(+(location.hash.slice(1)) || 1);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
  window.VOEG = { estado: S, ir, muestra };
})();
