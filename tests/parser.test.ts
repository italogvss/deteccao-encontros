import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lerArquivo, parsearConteudo } from "../src/parser";
import type { Posicao } from "../src/types";

const CABECALHO = "idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida";

function parsear(conteudo: string) {
  const posicoes: Posicao[] = [];
  const dados = parsearConteudo(conteudo, (posicao) => posicoes.push(posicao));
  return { ...dados, posicoes };
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
      const posicoes: Posicao[] = [];
      const dados = lerArquivo(caminho, (posicao) => posicoes.push(posicao), tamanhoBloco);

      assert.deepEqual(posicoes, esperado.posicoes, `bloco de ${tamanhoBloco} bytes`);
      assert.deepEqual(dados.cadastro, esperado.cadastro, `bloco de ${tamanhoBloco} bytes`);
      assert.equal(dados.linhasInvalidas, 1, `bloco de ${tamanhoBloco} bytes`);
    }
  } finally {
    rmSync(pasta, { recursive: true });
  }
});
