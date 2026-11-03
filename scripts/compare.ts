import { readFileSync } from "node:fs";
import type { Encontro } from "../src/types";

export interface Diferencas {
  /** Falsos negativos: estão no gabarito e não na saída. */
  faltando: string[];
  /** Falsos positivos: estão na saída e não no gabarito, ou repetem um par já visto. */
  sobrando: string[];
  /** Mesmo par e timestamp, com tipo diferente. */
  tipoErrado: string[];
  distancia: string[];
  posicoes: string[];
}

function chaveDoPar({ timestamp, monitoradosEncontro }: Encontro): string {
  const [a, b] = monitoradosEncontro;
  return `${timestamp}|${Math.min(a, b)}|${Math.max(a, b)}`;
}

/** Compara as coordenadas pelo conteúdo, sem depender da ordem das chaves no JSON. */
function mesmasPosicoes(a: Encontro, b: Encontro): boolean {
  const chaves = Object.keys(a.posicoes);
  return (
    chaves.length === Object.keys(b.posicoes).length &&
    chaves.every((id) => a.posicoes[id].lat === b.posicoes[id]?.lat && a.posicoes[id].lon === b.posicoes[id]?.lon)
  );
}

/**
 * Casa os registros por par e timestamp, e só depois compara o tipo: equivale a comparar os conjuntos de
 * chaves `timestamp|menorId|maiorId|tipo`, mas separa "tipo errado" de "faltando + sobrando". A distância
 * é comparada com igualdade exata, porque o gabarito usa a precisão completa do double.
 */
export function compararComGabarito(saida: Encontro[], gabarito: Encontro[]): Diferencas {
  const diferencas: Diferencas = { faltando: [], sobrando: [], tipoErrado: [], distancia: [], posicoes: [] };
  const pendentes = new Map(gabarito.map((encontro) => [chaveDoPar(encontro), encontro]));

  for (const encontro of saida) {
    const chave = chaveDoPar(encontro);
    const esperado = pendentes.get(chave);
    if (esperado === undefined) {
      diferencas.sobrando.push(`${chave}|${encontro.tipo}`);
      continue;
    }
    pendentes.delete(chave);

    if (encontro.tipo !== esperado.tipo) {
      diferencas.tipoErrado.push(`${chave}: ${encontro.tipo}, esperado ${esperado.tipo}`);
    }
    if (encontro.distanciaMetros !== esperado.distanciaMetros) {
      diferencas.distancia.push(`${chave}: ${encontro.distanciaMetros}, esperado ${esperado.distanciaMetros}`);
    }
    if (!mesmasPosicoes(encontro, esperado)) diferencas.posicoes.push(chave);
  }

  for (const [chave, { tipo }] of pendentes) diferencas.faltando.push(`${chave}|${tipo}`);
  return diferencas;
}

function lerEncontros(caminho: string): Encontro[] {
  return JSON.parse(readFileSync(caminho, "utf8")) as Encontro[];
}

/** O código de saída é 0 só com zero diferenças, para o script poder ser usado em automação. */
function main(args: string[]): void {
  if (args.length !== 2) {
    console.error("Uso: npm run compare -- <saida.json> <gabarito.json>");
    process.exitCode = 1;
    return;
  }

  const saida = lerEncontros(args[0]);
  const gabarito = lerEncontros(args[1]);
  const secoes = Object.entries(compararComGabarito(saida, gabarito));

  console.log(`Saída: ${saida.length} encontros. Gabarito: ${gabarito.length} encontros.`);
  for (const [nome, itens] of secoes) {
    console.log(`${nome}: ${itens.length}`);
    for (const item of itens) console.log(`  ${item}`);
  }
  if (secoes.some(([, itens]) => itens.length > 0)) process.exitCode = 1;
}

if (require.main === module) {
  main(process.argv.slice(2));
}
