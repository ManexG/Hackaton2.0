# Modelo de llegada del equipo

La app integra el modelo de [`ManexG/Hackaton2.0`, rama `prediction-model`, commit `4266afc`](https://github.com/ManexG/Hackaton2.0/tree/4266afc/model). Se conservan el script y el archivo entrenado originales en `model-tools/`. El archivo original tiene SHA-256 `e5f11fed02e5d5f58ff7c5741ffafc66c15c37a6cdfdd6614184600726255593`.

`public/data/eta-model.json` contiene los árboles y las predicciones base de los tres estimadores HistGradientBoosting: media y cuantiles 0.1 y 0.9. `src/etaModel.js` los evalúa con el mismo criterio de división y suma que scikit-learn. Esto funciona en la web y dentro del APK, sin añadir un servicio de Python a Cloudflare.

## Uso en los viajes

- La posición GPS se proyecta sobre la geometría de la ruta. Se usa la distancia por ese recorrido y la velocidad del vehículo en km/h, con respaldo de 5 m/s si no hay una velocidad utilizable.
- La hora y el día se calculan en `America/Mexico_City`. Se convierte el domingo=0 de los horarios al lunes=0 del modelo.
- No hay observaciones de lluvia ni un inventario de semáforos: ambas entradas se fijan en cero como escenario neutral, **no como mediciones reales**. La interfaz lo explica.
- La estimación se usa en llegadas a paradas, duración de los tramos y clasificación de viajes según el destino. Se mantienen las validaciones de GPS reciente, cobertura, sentido, disponibilidad y cierre del servicio.
- El rango de llegada se presenta como aproximación. Al sumar tramos o vueltas, los límites se suman; no representan un intervalo de confianza validado del viaje completo.
- Para distancias menores de 100 m o mayores de 8 km, velocidades fuera de 4–45 km/h, horas fuera de 05:00–22:59 o un modelo ausente/inválido, se usa la estimación geométrica anterior. Dentro de 25 m de la parada se muestra llegada inmediata. El modelo opcional tiene un límite de carga de cuatro segundos.

**El entrenamiento usó datos ficticios.** La igualdad de resultados con Python verifica la conversión, pero no demuestra precisión con viajes reales. Será necesario entrenar y evaluar con recorridos observados antes de presentar estas predicciones como confiables. No se añaden choferes ficticios al servicio publicado.

## Reproducir la exportación

Desde la carpeta de la app, con Python 3.12:

```sh
python -m venv .model-venv
# Activa el entorno según tu sistema; en Windows: .model-venv\Scripts\Activate.ps1
pip install -r model-tools/requirements.txt
python model-tools/export_eta.py --input model-tools/eta_model.joblib --output public/data/eta-model.json --fixtures tests/fixtures/eta-parity.json
npm test
```

El exportador acepta únicamente las clases numéricas necesarias del archivo original y requiere scikit-learn 1.9.1. Rechaza árboles categóricos o formatos inesperados. Si llega otro modelo, revisar su origen y adaptar el exportador antes de cargarlo.

La prueba de paridad compara **260 entradas y tres salidas por entrada** con el resultado original de Python, con tolerancia de `1e-9` minutos. Otras pruebas comprueban conversión de días, rangos ordenados, respaldo ante fallas, distancia de ruta, caducidad del GPS, fin de servicio y recomendaciones sin vehículos inventados.
