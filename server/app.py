"""
VOEG · Servidor puente para TU código Python (wavelet + IA).

Instalar:   pip install -r requirements.txt
Ejecutar:   uvicorn app:app --reload --port 8000
En la app (pantalla 4) escribe:  http://localhost:8000

Solo reemplaza las dos funciones marcadas con TODO.
"""
import io, json
import numpy as np
import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="VOEG API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------
# TODO 1: tu procesamiento wavelet. Recibe el DataFrame del sensor y las rutas
# de los videos; debe devolver la imagen wavelet como bytes PNG.
# --------------------------------------------------------------------------
def mi_wavelet(sensor: pd.DataFrame, video_od: bytes | None, video_oi: bytes | None, sesion: dict) -> bytes:
    import pywt
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    senal = sesion.get("opciones", {}).get("senal", "pitch")
    x = sensor[senal].to_numpy()
    coef, _ = pywt.cwt(x - x.mean(), np.arange(1, 64), "morl")
    fig = plt.figure(figsize=(4, 4), dpi=56); plt.axis("off")
    plt.imshow(np.abs(coef), aspect="auto", cmap="viridis")
    buf = io.BytesIO(); fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0); plt.close(fig)
    return buf.getvalue()


# --------------------------------------------------------------------------
# TODO 2: tu arquitectura de IA. Recibe la imagen wavelet (bytes PNG).
# --------------------------------------------------------------------------
def mi_diagnostico(imagen_png: bytes, sesion: dict) -> dict:
    # Ejemplo: modelo = tf.keras.models.load_model("modelo.h5"); pred = modelo.predict(...)
    clases = ["VPPB canal posterior derecho", "VPPB canal posterior izquierdo",
              "VPPB canal horizontal", "VPPB canal anterior", "Sin VPPB"]
    p = np.ones(len(clases)) / len(clases)            # <- reemplazar por la salida real
    i = int(np.argmax(p))
    return {
        "diagnostico": clases[i],
        "confianza": float(p[i]),
        "probabilidades": {c: float(v) for c, v in zip(clases, p)},
        "detalle": "Resultado generado por el modelo VOEG.",
    }


@app.post("/wavelet")
async def wavelet(sensor: UploadFile = File(...), od: UploadFile | None = File(None),
                  oi: UploadFile | None = File(None), sesion: str = Form("{}")):
    df = pd.read_csv(io.BytesIO(await sensor.read()))
    png = mi_wavelet(df, await od.read() if od else None, await oi.read() if oi else None, json.loads(sesion))
    return Response(content=png, media_type="image/png")


@app.post("/diagnostico")
async def diagnostico(imagen: UploadFile = File(...), sesion: str = Form("{}")):
    return mi_diagnostico(await imagen.read(), json.loads(sesion))
