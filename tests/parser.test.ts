import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type ConsumidorPosicoes, lerArquivo, parsearConteudo } from "../src/parser";
import type { Posicao } from "../src/types";

const CABECALHO = "idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida";

function criarColetor(): ConsumidorPosicoes & { posicoes: Posicao[] } {
  const posicoes: Posicao[] = [];
  let timestamp = "";
  return {
    posicoes,
    aoMudarTimestamp(novo) {
      timestamp = novo;
      return true;
    },
    aoLerPosicao(id, lat, lon) {
      posicoes.push({ id, timestamp, lat, lon });
    },
  };
}

function parsear(conteudo: string) {
  const coletor = criarColetor();
  const dados = parsearConteudo(conteudo, coletor)!;
  return { ...dados, posicoes: coletor.posicoes };
}

test("lê os campos: remove as aspas, aceita facção vazia e converte os números", () => {
  const { cadastro, posicoes, linhasInvalidas } = parsear(
    [
      CABECALHO,
      '7;1;"2024-01-01 00:00:00";-13.06443;-46.56289;false;',
      '9;;"2024-01-01 00:00:00";1.64046;-69.53950;true;"10"',
    ].join("\n"),
  );

  assert.equal(linhasInvalidas, 0);
  assert.deepEqual(posicoes, [
    { id: 7, timestamp: "2024-01-01 00:00:00", lat: -13.06443, lon: -46.56289 },
    { id: 9, timestamp: "2024-01-01 00:00:00", lat: 1.64046, lon: -69.5395 },
  ]);
  assert.equal(cadastro.get(7)?.idFaccao, 1);
  assert.equal(cadastro.get(7)?.ehVitima, false);
  assert.equal(cadastro.get(9)?.idFaccao, null);
  assert.equal(cadastro.get(9)?.ehVitima, true);
});

test("monta o vínculo nos dois sentidos, com vários agressores, mesmo que o agressor venha depois", () => {
  const { cadastro } = parsear(
    [
      '9;;"t1";1;1;true;"1,2"',
      '1;;"t1";1;1;false;',
      '2;;"t1";1;1;false;',
    ].join("\n"),
  );

  assert.deepEqual([...(cadastro.get(9)?.restricoes ?? [])], [1, 2]);
  assert.deepEqual([...(cadastro.get(1)?.restricoes ?? [])], [9]);
  assert.deepEqual([...(cadastro.get(2)?.restricoes ?? [])], [9]);
});

test("aceita BOM, \\r\\n, linhas vazias e última linha sem quebra", () => {
  const { posicoes, linhasInvalidas } = parsear(
    `﻿${CABECALHO}\r\n1;;"t1";1;2;false;\r\n\r\n   \r\n2;;"t1";3;4;false;`,
  );

  assert.equal(linhasInvalidas, 0);
  assert.deepEqual(posicoes.map((posicao) => posicao.id), [1, 2]);
});

test("não perde a primeira linha de um arquivo sem cabeçalho", () => {
  assert.equal(parsear('1;;"t1";1;2;false;').posicoes.length, 1);
});

test("descarta e conta linhas inválidas, sem interromper a leitura", () => {
  const invalidas = [
    "lixo",
    '1;;"t1";1',
    '1;;"t1";;2;false;',
    '1;;"t1";abc;2;false;',
    '1;;"t1";91;2;false;',
    'x;;"t1";1;2;false;',
    ';;"t1";1;2;false;',
    '1;;;1;2;false;',
    '1;;"t1";1;2;talvez;',
    '1;x;"t1";1;2;false;',
    '1;;"t1";1;2;true;"a"',
  ];

  const { posicoes, cadastro, linhasInvalidas } = parsear([...invalidas, '2;;"t1";1;2;false;'].join("\n"));

  assert.equal(linhasInvalidas, invalidas.length);
  assert.deepEqual(posicoes.map((posicao) => posicao.id), [2]);
  assert.deepEqual([...cadastro.keys()], [2]);
});

/** A primeira linha cadastra o ID e define o timestamp, então as seguintes tentam o caminho rápido. */
test("o caminho rápido dá exatamente o mesmo double que Number()", () => {
  const valores = ["0", "-0", "-0.00000", "0.1", "-13.06443", "1.64046", "90", "-90", "90.00000", "89.99999", "5.", ".5", "-.5", "0.000000000000001", "12.3456789012345"];
  for (let i = 0; i < 20000; i++) {
    const inteiro = (i * 7919) % 90;
    const decimais = String((i * 104729) % 100000).padStart(5, "0");
    valores.push(`${i % 2 === 0 ? "-" : ""}${inteiro}.${decimais}`);
  }

  const linhas = ['1;;"t";0;0;false;', ...valores.map((valor) => `1;;"t";${valor};${valor};false;`)];
  const { posicoes, linhasInvalidas } = parsear(linhas.join("\n"));

  assert.equal(linhasInvalidas, 0);
  valores.forEach((valor, i) => {
    assert.ok(Object.is(posicoes[i + 1].lat, Number(valor)), `lat ${valor}`);
    assert.ok(Object.is(posicoes[i + 1].lon, Number(valor)), `lon ${valor}`);
  });
});

test("formato incomum depois da primeira linha cai no caminho lento, com o mesmo resultado", () => {
  const validas: [string, Posicao][] = [
    ['1;;"t";+1.5;2;false;', { id: 1, timestamp: "t", lat: 1.5, lon: 2 }],
    ['1;;"t"; 1.5 ;2;false;', { id: 1, timestamp: "t", lat: 1.5, lon: 2 }],
    ['1;;"t";1e1;2;false;', { id: 1, timestamp: "t", lat: 10, lon: 2 }],
    ['1;;"t";1.12345678901234567;2;false;', { id: 1, timestamp: "t", lat: 1.1234567890123457, lon: 2 }],
    ['01;;"t";3;4;false;', { id: 1, timestamp: "t", lat: 3, lon: 4 }],
    ['  1;;"t";3;4;false;', { id: 1, timestamp: "t", lat: 3, lon: 4 }],
    ["1;;t;3;4;false;", { id: 1, timestamp: "t", lat: 3, lon: 4 }],
    ['1;;"u";3;4;false;', { id: 1, timestamp: "u", lat: 3, lon: 4 }],
    ['1;;"t";3;4;\r', { id: 1, timestamp: "t", lat: 3, lon: 4 }],
  ];
  const invalidas = ['1;;"t";1.5.5;2;false;', '1;;"t";-;2;false;', '1;;"t";.;2;false;', '1;;"t";;2;false;', '1;;"t";90.00001;2;false;', '1;;"t";1;180.00001;false;', '1;;"t";1;2', '1;;"";1;2;false;', '1;;"t";1;'];

  const { posicoes, linhasInvalidas } = parsear(['1;;"t";0;0;false;', ...validas.map(([linha]) => linha), ...invalidas].join("\n"));

  assert.deepEqual(posicoes.slice(1), validas.map(([, esperada]) => esperada));
  assert.equal(linhasInvalidas, invalidas.length);
});

test("ID acima da tabela do caminho rápido continua sendo lido", () => {
  const { posicoes, linhasInvalidas } = parsear(['70000;;"t";1;2;false;', '70000;;"t";3;4;false;'].join("\n"));

  assert.equal(linhasInvalidas, 0);
  assert.deepEqual(posicoes.map((posicao) => [posicao.id, posicao.lat]), [[70000, 1], [70000, 3]]);
});

test("timestamp fora do padrão de 19 caracteres também funciona, inclusive com acento", () => {
  const { posicoes } = parsear(['1;;"horário é único";1;2;false;', '1;;"horário é único";3;4;false;', '1;;"outro";5;6;false;'].join("\n"));

  assert.deepEqual(posicoes.map((posicao) => posicao.timestamp), ["horário é único", "horário é único", "outro"]);
});

test("o consumidor pode interromper a leitura, e o resultado é null", () => {
  const conteudo = ['1;;"t1";1;2;false;', '1;;"t2";3;4;false;', '1;;"t3";5;6;false;'].join("\n");
  const pasta = mkdtempSync(join(tmpdir(), "parser-"));
  try {
    const caminho = join(pasta, "dados.txt");
    writeFileSync(caminho, conteudo);

    for (const ler of [
      (consumidor: ConsumidorPosicoes) => parsearConteudo(conteudo, consumidor),
      (consumidor: ConsumidorPosicoes) => lerArquivo(caminho, consumidor),
    ]) {
      const vistos: string[] = [];
      const dados = ler({
        aoMudarTimestamp(timestamp) {
          vistos.push(timestamp);
          return timestamp !== "t2";
        },
        aoLerPosicao() {},
      });

      assert.equal(dados, null);
      assert.deepEqual(vistos, ["t1", "t2"]);
    }
  } finally {
    rmSync(pasta, { recursive: true });
  }
});

/** Blocos menores que uma linha obrigam a guardar o pedaço pendente e a fazer o bloco crescer. */
test("lerArquivo devolve o mesmo resultado com linhas cortadas entre blocos", () => {
  const conteudo = [
    CABECALHO,
    '1;;"2024-01-01 00:00:00";1.5;2.5;false;',
    '9;;"2024-01-01 00:00:00";3.5;4.5;true;"1"',
    '1;;"horário é único";5.5;6.5;false;',
    "lixo",
    '9;;"horário é único";7.5;8.5;true;"1"',
  ].join("\n");
  const esperado = parsear(conteudo);

  const pasta = mkdtempSync(join(tmpdir(), "parser-"));
  try {
    const caminho = join(pasta, "dados.txt");
    writeFileSync(caminho, conteudo);

    for (const tamanhoBloco of [1, 7, 16, 64, 1024]) {
      const coletor = criarColetor();
      const dados = lerArquivo(caminho, coletor, tamanhoBloco)!;

      assert.deepEqual(coletor.posicoes, esperado.posicoes, `bloco de ${tamanhoBloco} bytes`);
      assert.deepEqual(dados.cadastro, esperado.cadastro, `bloco de ${tamanhoBloco} bytes`);
      assert.equal(dados.linhasInvalidas, 1, `bloco de ${tamanhoBloco} bytes`);
    }
  } finally {
    rmSync(pasta, { recursive: true });
  }
});
