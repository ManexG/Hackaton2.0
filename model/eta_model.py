"""Modelo de tiempo de espera (ETA) de una combi a una estación.

Uso:
    python eta_model.py train            # genera datos ficticios y entrena
    python eta_model.py predict          # ejemplo de predicción

Cuando existan datos reales, guárdalos en CSV con las mismas columnas que
`generate_synthetic_data` y pásalos a `train(df)`.
"""
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

MODEL_PATH = Path(__file__).parent / "eta_model.joblib"
FEATURES = ["distance_m", "speed_kmh", "traffic_lights", "hour", "weekday", "rain"]
TARGET = "wait_min"
QUANTILES = (0.1, 0.9)  # rango de incertidumbre mostrado al usuario


def generate_synthetic_data(n: int = 20000, seed: int = 42) -> pd.DataFrame:
    """Simula combis: tiempo = distancia/velocidad + semáforos + tráfico + lluvia."""
    rng = np.random.default_rng(seed)
    distance = rng.uniform(100, 8000, n)            # metros hasta la estación
    hour = rng.integers(5, 23, n)
    weekday = rng.integers(0, 7, n)                 # 0 = lunes
    rain = rng.random(n) < 0.15
    lights = np.clip((distance / 400 + rng.normal(0, 1, n)).round(), 0, None)

    rush = np.isin(hour, [7, 8, 9, 14, 15, 18, 19]) & (weekday < 5)
    traffic_factor = np.where(rush, 0.6, 1.0) * np.where(rain, 0.8, 1.0)
    speed = np.clip(rng.normal(28, 6, n) * traffic_factor, 4, None)  # km/h actual

    travel = distance / 1000 / (speed * np.where(rush, 0.85, 1.0) / 60)
    red_wait = lights * rng.exponential(0.4, n)     # min perdidos en semáforos
    stops = (distance / 1000) * rng.uniform(0.2, 0.6, n)  # ascensos/descensos
    wait = travel + red_wait + stops + rng.normal(0, 0.5, n)

    return pd.DataFrame({
        "distance_m": distance, "speed_kmh": speed, "traffic_lights": lights,
        "hour": hour, "weekday": weekday, "rain": rain.astype(int),
        TARGET: np.clip(wait, 0.2, None),
    })


def train(df: pd.DataFrame) -> dict:
    X_tr, X_te, y_tr, y_te = train_test_split(df[FEATURES], df[TARGET], test_size=0.2, random_state=0)
    mean = HistGradientBoostingRegressor(random_state=0).fit(X_tr, y_tr)
    bounds = {q: HistGradientBoostingRegressor(loss="quantile", quantile=q, random_state=0).fit(X_tr, y_tr)
              for q in QUANTILES}

    baseline = mean_absolute_error(y_te, np.full(len(y_te), y_tr.mean()))
    mae = mean_absolute_error(y_te, mean.predict(X_te))
    print(f"MAE modelo: {mae:.2f} min | MAE línea base (promedio): {baseline:.2f} min")

    joblib.dump({"mean": mean, "bounds": bounds}, MODEL_PATH)
    return {"mae": mae, "baseline_mae": baseline}


def predict_wait(distance_m, speed_kmh, traffic_lights, hour, weekday, rain=False) -> dict:
    """Devuelve el tiempo de espera estimado en minutos y su rango."""
    m = joblib.load(MODEL_PATH)
    row = pd.DataFrame([[distance_m, speed_kmh, traffic_lights, hour, weekday, int(rain)]], columns=FEATURES)
    lo, hi = (float(m["bounds"][q].predict(row)[0]) for q in QUANTILES)
    est = float(m["mean"].predict(row)[0])
    return {"minutes": round(est, 1), "min": round(min(lo, est), 1), "max": round(max(hi, est), 1)}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "train"
    if cmd == "train":
        train(generate_synthetic_data())
    else:
        print(predict_wait(distance_m=2500, speed_kmh=22, traffic_lights=5, hour=8, weekday=1, rain=True))
