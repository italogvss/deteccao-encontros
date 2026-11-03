import assert from "node:assert/strict";
import { test } from "node:test";
import { classificarEncontro } from "../src/classifier";
import { parsearConteudo } from "../src/parser";
import type { Pessoa } from "../src/types";

/** Monta as pessoas pelo parser real, para cobrir também o vínculo nos dois sentidos. */
function cadastrar(...linhas: string[]): (id: number) => Pessoa {
  const { cadastro } = parsearConteudo(linhas.join("\n"), () => {});
  return (id) => cadastro.get(id)!;
}

function classificarNasDuasOrdens(a: Pessoa, b: Pessoa) {
  const tipo = classificarEncontro(a, b);
  assert.equal(classificarEncontro(b, a), tipo);
  return tipo;
}

test("facção vazia nos dois lados resulta em generico", () => {
  const pessoa = cadastrar('1;;"t";1;1;false;', '2;;"t";1;1;false;');
  assert.equal(classificarNasDuasOrdens(pessoa(1), pessoa(2)), "generico");
});

test("mesma facção resulta em faccao, e facções diferentes em generico", () => {
  const pessoa = cadastrar('1;5;"t";1;1;false;', '2;5;"t";1;1;false;', '3;6;"t";1;1;false;', '4;0;"t";1;1;false;', '5;0;"t";1;1;false;');
  assert.equal(classificarNasDuasOrdens(pessoa(1), pessoa(2)), "faccao");
  assert.equal(classificarNasDuasOrdens(pessoa(1), pessoa(3)), "generico");
  assert.equal(classificarNasDuasOrdens(pessoa(4), pessoa(5)), "faccao");
});

test("vítima com vários agressores: protetiva com cada um, nas duas ordens", () => {
  const pessoa = cadastrar('9;;"t";1;1;true;"1,2"', '1;;"t";1;1;false;', '2;;"t";1;1;false;');
  assert.equal(classificarNasDuasOrdens(pessoa(9), pessoa(1)), "protetiva");
  assert.equal(classificarNasDuasOrdens(pessoa(9), pessoa(2)), "protetiva");
});

test("agressor de facção com a própria vítima resulta em protetiva, pela prioridade", () => {
  const pessoa = cadastrar('9;5;"t";1;1;true;"1"', '1;5;"t";1;1;false;');
  assert.equal(classificarNasDuasOrdens(pessoa(9), pessoa(1)), "protetiva");
});

test("vítima perto de quem não é seu agressor é ignorada, a menos que a opção esteja ligada", () => {
  const pessoa = cadastrar('9;;"t";1;1;true;"1"', '2;;"t";1;1;false;');
  assert.equal(classificarNasDuasOrdens(pessoa(9), pessoa(2)), null);
  assert.equal(classificarEncontro(pessoa(9), pessoa(2), { incluirVitimaEmGenerico: true }), "generico");
});
