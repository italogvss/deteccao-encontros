import assert from "node:assert/strict";
import { test } from "node:test";
import { compararComGabarito } from "../scripts/compare";
import type { Encontro, TipoEncontro } from "../src/types";

function encontro(timestamp: string, a: number, b: number, tipo: TipoEncontro = "generico", distanciaMetros = 5, lat = 1): Encontro {
  return {
    tipo,
    monitoradosEncontro: [a, b],
    timestamp,
    posicoes: { [a]: { lat, lon: 1 }, [b]: { lat, lon: 1 } },
    distanciaMetros,
  };
}

test("saída igual ao gabarito não tem diferenças", () => {
  const diferencas = compararComGabarito([encontro("t1", 1, 2)], [encontro("t1", 1, 2)]);
  assert.deepEqual(diferencas, { faltando: [], sobrando: [], tipoErrado: [], distancia: [], posicoes: [] });
});

test("separa cada tipo de diferença", () => {
  const saida = [
    encontro("t1", 1, 2, "faccao"),
    encontro("t2", 1, 2, "generico", 5.000000000000001),
    encontro("t3", 1, 2, "generico", 5, 2),
    encontro("t4", 1, 2),
    encontro("t5", 1, 2),
    encontro("t5", 1, 2),
  ];
  const gabarito = [
    encontro("t1", 1, 2, "generico"),
    encontro("t2", 1, 2),
    encontro("t3", 1, 2),
    encontro("t5", 1, 2),
    encontro("t6", 1, 2),
  ];

  assert.deepEqual(compararComGabarito(saida, gabarito), {
    faltando: ["t6|1|2|generico"],
    sobrando: ["t4|1|2|generico", "t5|1|2|generico"],
    tipoErrado: ["t1|1|2: faccao, esperado generico"],
    distancia: ["t2|1|2: 5.000000000000001, esperado 5"],
    posicoes: ["t3|1|2"],
  });
});
