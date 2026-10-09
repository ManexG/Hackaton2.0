"""Export the reviewed numeric sklearn model without arbitrary pickle globals."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import sklearn
from joblib.numpy_pickle import NumpyUnpickler

ALLOWED = {
    ('sklearn.ensemble._hist_gradient_boosting.gradient_boosting', 'HistGradientBoostingRegressor'),
    ('sklearn.ensemble._hist_gradient_boosting.binning', '_BinMapper'),
    ('sklearn.ensemble._hist_gradient_boosting.predictor', 'TreePredictor'),
    ('sklearn._loss.loss', 'HalfSquaredError'),
    ('sklearn._loss.loss', 'PinballLoss'),
    ('sklearn._loss._loss', 'CyHalfSquaredError'),
    ('sklearn._loss._loss', 'CyPinballLoss'),
    ('sklearn._loss.link', 'IdentityLink'),
    ('sklearn._loss.link', 'Interval'),
    ('joblib.numpy_pickle', 'NumpyArrayWrapper'),
    ('numpy', 'ndarray'), ('numpy', 'dtype'),
    ('numpy._core.multiarray', 'scalar'), ('numpy.core.multiarray', 'scalar'),
    ('numpy._core.multiarray', '_reconstruct'), ('numpy.core.multiarray', '_reconstruct'),
    ('numpy.random._pickle', '__generator_ctor'), ('numpy.random._pickle', '__bit_generator_ctor'),
    ('numpy.random._pcg64', 'PCG64'),
    ('numpy.random.bit_generator', '__pyx_unpickle_SeedSequence'), ('numpy.random.bit_generator', 'SeedSequence'),
}
class NumericModelUnpickler(NumpyUnpickler):
    def find_class(self, module, name):
        if (module, name) not in ALLOWED:
            raise ValueError(f'Unapproved pickle global: {module}.{name}')
        return super().find_class(module, name)

def export_estimator(estimator):
    trees = []
    for stage in estimator._predictors:
        if len(stage) != 1:
            raise ValueError('Only single-output regression is supported')
        nodes = stage[0].nodes
        if any(nodes['is_categorical']):
            raise ValueError('Categorical split needs a different exporter')
        trees.append([[float(n['value']), int(n['feature_idx']), float(n['num_threshold']),
                       int(n['missing_go_to_left']), int(n['left']), int(n['right']), int(n['is_leaf'])]
                      for n in nodes])
    return {'baseline': float(estimator._baseline_prediction[0, 0]), 'trees': trees}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    args = parser.parse_args()
    if sklearn.__version__ != '1.9.1':
        raise ValueError('Use scikit-learn==1.9.1, the version stored in this model')
    with args.input.open('rb') as stream:
        bundle = NumericModelUnpickler(str(args.input), stream, ensure_native_byte_order=True).load()
    if set(bundle) != {'mean', 'bounds'} or set(bundle['bounds']) != {0.1, 0.9}:
        raise ValueError('Unexpected model structure')
    feature_names = ['distance_m', 'speed_kmh', 'traffic_lights', 'hour', 'weekday', 'rain']
    model = {
        'format': 'las-palmas-eta-v1', 'features': feature_names,
        'provenance': {'repository': 'ManexG/Hackaton2.0', 'branch': 'prediction-model',
                       'commit': '4266afc', 'sha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
                       'sklearn': sklearn.__version__, 'training': 'synthetic', 'quantiles': [0.1, 0.9]},
        'mean': export_estimator(bundle['mean']),
        'lower': export_estimator(bundle['bounds'][0.1]),
        'upper': export_estimator(bundle['bounds'][0.9]),
    }
    rng = np.random.default_rng(456)
    samples = [[100., 4., 0, 5, 0, 0], [8000., 45., 20, 22, 6, 1],
               [1200., 18., 0, 8, 0, 0], [1200., 18., 0, 14, 5, 0]]
    samples += [[float(rng.uniform(100, 8000)), float(rng.uniform(4, 45)),
                 int(rng.integers(0, 21)), int(rng.integers(5, 23)), int(rng.integers(0, 7)),
                 int(rng.integers(0, 2))] for _ in range(256)]
    frame = pd.DataFrame(samples, columns=feature_names)
    # Predictor output is not rounded here, so JS parity catches threshold/sum errors.
    estimates = np.stack([bundle['mean'].predict(frame), bundle['bounds'][0.1].predict(frame),
                          bundle['bounds'][0.9].predict(frame)], axis=1)
    fixtures = [{'input': sample, 'expected': result.tolist()} for sample, result in zip(samples, estimates)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.fixtures.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    args.fixtures.write_text(json.dumps(fixtures, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'model_bytes': args.output.stat().st_size, 'fixtures': len(fixtures),
                      'sha256': model['provenance']['sha256'],
                      'trees': [len(model[key]['trees']) for key in ['mean', 'lower', 'upper']]}))

if __name__ == '__main__':
    main()
