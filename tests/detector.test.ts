import assert from "node:assert/strict";
import { test } from "node:test";
import { detectarEncontros } from "../src/detector";
import { distanciaHaversine } from "../src/geo";
import { parsearConteudo } from "../src/parser";

function detectar(...linhas: string[]) {
  return detectarEncontros((consumidor) => parsearConteudo(linhas.join("\n"), consumidor));
}

/** Gerador simples com semente, para o teste ser reproduzível. */
function criarAleatorio(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
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

test("ID repetido é descartado também em arquivo fora de ordem e com ID alto", () => {
  const { encontros, posicoesRepetidas } = detectar(
    '70000;;"t2";0;0;false;',
    '70000;;"t1";0;0;false;',
    '70000;;"t1";50;50;false;',
    '70001;;"t1";0;0;false;',
  );

  assert.equal(posicoesRepetidas, 1);
  assert.deepEqual(encontros.map((encontro) => encontro.monitoradosEncontro), [[70000, 70001]]);
});

test("ID alto repetido em arquivo em ordem também é descartado", () => {
  const { encontros, posicoesRepetidas } = detectar(
    '70000;;"t1";0;0;false;',
    '70000;;"t1";50;50;false;',
    '70001;;"t1";0;0;false;',
    '70000;;"t2";50;50;false;',
    '70001;;"t2";0;0;false;',
  );

  assert.equal(posicoesRepetidas, 1);
  assert.deepEqual(encontros.map((encontro) => encontro.timestamp), ["t1"]);
});

test("a varredura por latitude encontra os mesmos pares que comparar todos, com grupos de tamanho variável", () => {
  const aleatorio = criarAleatorio(42);
  const linhas: string[] = [];
  const esperado: string[] = [];

  for (let t = 0; t < 40; t++) {
    const timestamp = `t${String(t).padStart(3, "0")}`;
    const tamanho = 2 + Math.floor(aleatorio() * 30);
    const pessoas: [number, number, number][] = [];

    for (let id = 0; id < tamanho; id++) {
      const lat = Number((10 + Math.floor(aleatorio() * 40) * 0.00006).toFixed(5));
      const lon = Number((20 + Math.floor(aleatorio() * 6) * 0.00006).toFixed(5));
      pessoas.push([id, lat, lon]);
      linhas.push(`${id};;"${timestamp}";${lat};${lon};false;`);
    }

    for (let i = 0; i < tamanho; i++) {
      for (let j = i + 1; j < tamanho; j++) {
        const distancia = distanciaHaversine(pessoas[i][1], pessoas[i][2], pessoas[j][1], pessoas[j][2]);
        if (distancia < 20) esperado.push(`${timestamp}|${i}|${j}|${distancia}`);
      }
    }
  }

  const obtido = detectar(...linhas).encontros.map(
    ({ timestamp, monitoradosEncontro: [a, b], distanciaMetros }) => `${timestamp}|${a}|${b}|${distanciaMetros}`,
  );
  assert.ok(esperado.length > 100);
  assert.deepEqual(obtido.sort(), esperado.sort());
});

test("arquivo embaralhado dá o mesmo resultado que o arquivo em ordem", () => {
  const emOrdem = [
    '1;;"t1";0;0;false;',
    '2;;"t1";0;0;false;',
    '3;;"t1";5;5;false;',
    '1;;"t2";5;5;false;',
    '2;;"t2";0;0;false;',
    '3;;"t2";5;5;false;',
    '1;;"t3";7;7;false;',
    '2;;"t3";7;7;false;',
    '3;;"t3";7;7;false;',
  ];
  const embaralhado = [emOrdem[4], emOrdem[8], emOrdem[0], emOrdem[5], emOrdem[2], emOrdem[7], emOrdem[1], emOrdem[3], emOrdem[6]];

  assert.deepEqual(detectar(...embaralhado), detectar(...emOrdem));
  assert.equal(detectar(...emOrdem).encontros.length, 5);
});

test("classifica com o cadastro completo, mesmo que o vínculo só apareça depois do encontro", () => {
  const { encontros } = detectar(
    '1;;"t1";0;0;false;',
    '9;;"t1";0;0;true;"1"',
  );

  assert.equal(encontros[0].tipo, "protetiva");
});
