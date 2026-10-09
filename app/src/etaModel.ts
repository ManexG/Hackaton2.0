// Numeric inference for the team's HistGradientBoosting model. No Python service is needed on Android or Workers.
type Node = [value: number, feature: number, threshold: number, missingLeft: number, left: number, right: number, leaf: number];
interface Ensemble { baseline: number; trees: Node[][] }
export interface EtaModel {
  format: 'las-palmas-eta-v1'; features: string[];
  provenance: { training: 'synthetic'; commit: string; sha256: string; sklearn: string; quantiles: number[] };
  mean: Ensemble; lower: Ensemble; upper: Ensemble;
}
export interface TravelPrediction { seconds: number; minSeconds: number; maxSeconds: number; experimental: boolean }
const features = ['distance_m', 'speed_kmh', 'traffic_lights', 'hour', 'weekday', 'rain'];
let installed: EtaModel | null = null;
export function installEtaModel(value: unknown): boolean {
  installed = null;
  const model = value as EtaModel | null;
  if (!model || model.format !== 'las-palmas-eta-v1' || JSON.stringify(model.features) !== JSON.stringify(features) || model.provenance?.training !== 'synthetic') return false;
  for (const key of ['mean', 'lower', 'upper'] as const) {
    const ensemble = model[key];
    if (!ensemble || !Number.isFinite(ensemble.baseline) || !Array.isArray(ensemble.trees) || !ensemble.trees.length || ensemble.trees.length > 1000) return false;
    for (const nodes of ensemble.trees) {
      if (!Array.isArray(nodes) || !nodes.length || nodes.length > 4096) return false;
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (!Array.isArray(node) || node.length !== 7 || !node.every(Number.isFinite) || ![0, 1].includes(node[6]) || ![0, 1].includes(node[3])) return false;
        if (!node[6] && (!Number.isInteger(node[1]) || node[1] < 0 || node[1] >= features.length || ![node[4], node[5]].every(child => Number.isInteger(child) && child > index && child < nodes.length))) return false;
      }
    }
  }
  installed = model;
  return true;
}
export function etaModelReady() { return installed !== null; }
function evaluate(ensemble: Ensemble, input: number[]): number {
  let result = ensemble.baseline;
  for (const nodes of ensemble.trees) {
    let node = nodes[0];
    while (!node[6]) {
      const value = input[node[1]];
      const left = Number.isNaN(value) ? Boolean(node[3]) : value <= node[2];
      node = nodes[left ? node[4] : node[5]];
    }
    result += node[0];
  }
  return result;
}
export function predictEtaRaw(model: EtaModel, input: number[]) {
  return [evaluate(model.mean, input), evaluate(model.lower, input), evaluate(model.upper, input)];
}
export function modelTravel(distanceMeters: number, speedKmh: number, cityDay: number, citySeconds: number): TravelPrediction | null {
  const hour = Math.floor(citySeconds / 3600);
  // Outside the synthetic training domain, keep the physical distance/speed fallback.
  if (!installed || !Number.isFinite(distanceMeters) || !Number.isFinite(speedKmh) || distanceMeters < 100 || distanceMeters > 8000 || speedKmh < 4 || speedKmh > 45 || hour < 5 || hour > 22) return null;
  // The model uses Monday=0; service schedules use Sunday=0. Weather and lights are unobserved neutral scenarios.
  const input = [distanceMeters, speedKmh, 0, hour, (cityDay + 6) % 7, 0];
  const [mean, lower, upper] = predictEtaRaw(installed, input);
  const seconds = Math.max(0, mean * 60);
  return { seconds, minSeconds: Math.max(0, Math.min(lower * 60, seconds)), maxSeconds: Math.max(upper * 60, seconds), experimental: true };
}
export function arrivalRangeLabel(prediction: TravelPrediction) {
  return `Entre ${Math.floor(prediction.minSeconds / 60)} y ${Math.ceil(prediction.maxSeconds / 60)} min aprox.`;
}
