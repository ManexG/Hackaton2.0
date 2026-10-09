export type Point = [number, number];
export type PlaceCategory = 'food' | 'health' | 'interest' | 'shopping' | 'education' | 'services' | 'street';
export interface Place {
  id: string;
  name: string;
  description: string;
  kind: 'reference' | 'business' | 'street' | 'stop' | 'pin';
  point: Point;
  demo: boolean;
  aliases?: string[];
  category?: PlaceCategory;
  source?: 'osm' | 'geocoder' | 'user' | 'demo';
  address?: string;
  geometry?: Point[];
  streetSegments?: Point[][];
}
export interface Stop { id: string; name: string; point: Point }
export interface Route {
  id: string;
  name: string;
  color: string;
  fare: number;
  headway: number;
  bidirectional: boolean;
  stops: string[];
  segments: Point[][];
}
export interface Network {
  version: number;
  demo: boolean;
  city: string;
  coverage: { name: string; bounds: [Point, Point]; polygon: Point[] };
  stops: Stop[];
  places: Place[];
  routes: Route[];
  addressRanges: { street: string; aliases: string[]; first: number; last: number; from: Point; to: Point }[];
}
export interface Leg {
  routeId: string;
  from: string;
  to: string;
  stopIds: string[];
  geometry: Point[];
  rideMinutes: number;
}
export interface Journey {
  id: string;
  legs: Leg[];
  origin: Place;
  destination: Place;
  walkMeters: number;
  totalMinutes: number;
  fare: number;
  transfers: number;
}
export interface PlaceCatalog {
  source: string;
  license: string;
  attribution: string;
  importedAt: string;
  places: Place[];
}
