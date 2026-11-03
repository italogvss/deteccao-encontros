import assert from "node:assert/strict";
import { test } from "node:test";
import { distanciaHaversine, estaEmEncontro, LIMITE_DELTA_LAT_GRAUS, RAIO_TERRA_METROS } from "../src/geo";

/** Todos os valores dos dois gabaritos. A comparação é exata: uma tolerância esconderia erro na última casa. */
const CASOS_GABARITO: [number, number, number, number, number][] = [
  [-31.93195, -40.61438, -31.93187, -40.61435, 9.33522817789823],
  [-28.28206, -44.63511, -28.28207, -44.6352, 8.882771981092958],
  [1.83355, -69.5461, 1.83351, -69.54618, 9.941503149375345],
  [-13.02054, -46.40609, -13.02046, -46.40609, 8.895594131622975],
  [-14.62732, -36.31859, -14.62731, -36.31869, 10.81640474094182],
  [-7.33193, -65.9313, -7.33197, -65.93137, 8.909619516337239],
  [-25.99892, -56.96696, -25.99883, -56.96694, 10.205209934010645],
  [-15.03744, -73.42167, -15.03739, -73.42174, 9.349741643529189],
  [-29.13547, -43.25292, -29.13546, -43.25301, 8.811738897421028],
  [-14.77075, -55.87742, -14.77068, -55.87738, 8.892813491126276],
];

test("Haversine bate exatamente com os gabaritos, nas duas ordens do par", () => {
  for (const [lat1, lon1, lat2, lon2, esperado] of CASOS_GABARITO) {
    assert.equal(distanciaHaversine(lat1, lon1, lat2, lon2), esperado);
    assert.equal(distanciaHaversine(lat2, lon2, lat1, lon1), esperado);
  }
});

test("o limite de 20 m é estrito", () => {
  assert.equal(estaEmEncontro(19.99), true);
  assert.equal(estaEmEncontro(20), false);
});

test("o filtro de latitude não descarta um par a menos de 20 m", () => {
  const umMetroEmGraus = (180 / Math.PI) / RAIO_TERRA_METROS;
  const deltaLat = 19.99 * umMetroEmGraus;

  assert.ok(deltaLat < LIMITE_DELTA_LAT_GRAUS);
  assert.equal(estaEmEncontro(distanciaHaversine(10, 20, 10 + deltaLat, 20)), true);
});
