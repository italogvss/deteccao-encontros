import assert from "node:assert/strict";
import { test } from "node:test";
import { detectarEncontros } from "../src/detector";
import { parsearConteudo } from "../src/parser";

function detectar(...linhas: string[]) {
  return detectarEncontros((aoLerPosicao) => parsearConteudo(linhas.join("\n"), aoLerPosicao));
}

test("gera o registro no formato de saída, com IDs em ordem crescente", () => {
  const { encontros } = detectar(
    '8;1;"2024-01-01 00:36:00";-13.02046;-46.40609;false;',
    '7;1;"2024-01-01 00:36:00";-13.02054;-46.40609;false;',
  );

  assert.deepEqual(encontros, [
    {
      tipo: "faccao",
      monitoradosEncontro: [7, 8],
      timestamp: "2024-01-01 00:36:00",
      posicoes: {
        "7": { lat: -13.02054, lon: -46.40609 },
        "8": { lat: -13.02046, lon: -46.40609 },
      },
      distanciaMetros: 8.895594131622975,
    },
  ]);
});

test("só compara posições do mesmo timestamp, sem depender da ordem do arquivo", () => {
  const { encontros } = detectar(
    '1;;"t2";0;0;false;',
    '2;;"t1";0;0;false;',
    '3;;"t3";50;50;false;',
    '1;;"t1";0;0;false;',
    '2;;"t3";0;0;false;',
    '1;;"t3";0;0;false;',
    '3;;"t2";0;0;false;',
  );

  assert.deepEqual(
    encontros.map(({ timestamp, monitoradosEncontro }) => [timestamp, ...monitoradosEncontro]),
    [
      ["t1", 1, 2],
      ["t2", 1, 3],
      ["t3", 1, 2],
    ],
  );
});

test("descarta o par a 20 m ou mais", () => {
  assert.deepEqual(detectar('1;;"t";0;0;false;', '2;;"t";0.00018;0;false;').encontros, []);
  assert.deepEqual(detectar('1;;"t";0;0;false;', '2;;"t";0;0.1;false;').encontros, []);
});

test("ID repetido no mesmo timestamp vale pela primeira posição e não encontra a si mesmo", () => {
  const { encontros, posicoesRepetidas } = detectar(
    '1;;"t";0;0;false;',
    '1;;"t";0;0;false;',
    '1;;"t";50;50;false;',
    '2;;"t";0;0;false;',
  );

  assert.equal(posicoesRepetidas, 2);
  assert.deepEqual(encontros.map((encontro) => encontro.monitoradosEncontro), [[1, 2]]);
});

test("classifica com o cadastro completo, mesmo que o vínculo só apareça depois do encontro", () => {
  const { encontros } = detectar(
    '1;;"t1";0;0;false;',
    '9;;"t1";0;0;true;"1"',
  );

  assert.equal(encontros[0].tipo, "protetiva");
});
