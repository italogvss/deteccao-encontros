import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { lerArquivo } from "./parser";
import type { Posicao } from "./types";

function listarArquivos(entradas: string[]): string[] {
  return entradas.flatMap((entrada) => {
    if (!statSync(entrada).isDirectory()) return [entrada];
    return readdirSync(entrada)
      .filter((nome) => nome.endsWith(".txt"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((nome) => join(entrada, nome));
  });
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function formatarPosicao(posicao: Posicao | null): string {
  if (posicao === null) return "-";
  const { id, timestamp, coordenadas } = posicao;
  return `id ${id} em ${timestamp} (${coordenadas.lat}, ${coordenadas.lon})`;
}

/** Por enquanto só lê o arquivo e imprime um resumo, para validar a leitura. */
function resumirArquivo(caminho: string): void {
  const timestamps = new Set<string>();
  let posicoes = 0;
  let primeira: Posicao | null = null;
  let ultima: Posicao | null = null;
  let emOrdem = true;

  const inicio = performance.now();
  const { cadastro, linhasInvalidas } = lerArquivo(caminho, (posicao) => {
    posicoes++;
    primeira ??= posicao;
    // O parser reaproveita a mesma string por timestamp, então só há trabalho quando ele muda.
    if (ultima === null || ultima.timestamp !== posicao.timestamp) {
      if (ultima !== null && posicao.timestamp < ultima.timestamp) emOrdem = false;
      timestamps.add(posicao.timestamp);
    }
    ultima = posicao;
  });
  const tempoMs = performance.now() - inicio;

  const pessoas = [...cadastro.values()];
  const vitimas = pessoas.filter((pessoa) => pessoa.ehVitima);
  const comFaccao = pessoas.filter((pessoa) => pessoa.idFaccao !== null).length;
  const vinculos = vitimas.reduce((total, vitima) => total + vitima.restricoes.size, 0);

  console.log(basename(caminho));
  console.log(`  Posições lidas:   ${formatarNumero(posicoes)}`);
  console.log(`  Linhas inválidas: ${formatarNumero(linhasInvalidas)}`);
  console.log(`  Pessoas:          ${pessoas.length} (com facção: ${comFaccao}, vítimas: ${vitimas.length}, vínculos de medida: ${vinculos})`);
  console.log(`  Timestamps:       ${formatarNumero(timestamps.size)} (em ordem no arquivo: ${emOrdem ? "sim" : "não"})`);
  console.log(`  Primeira posição: ${formatarPosicao(primeira)}`);
  console.log(`  Última posição:   ${formatarPosicao(ultima)}`);
  console.log(`  Tempo de leitura: ${formatarNumero(Math.round(tempoMs))} ms`);
  // `maxRSS` é o pico do processo até aqui, em KB: em uma execução com vários arquivos, ele só cresce.
  console.log(`  Pico de memória:  ${formatarNumero(Math.round(process.resourceUsage().maxRSS / 1024))} MB`);
}

function main(args: string[]): void {
  if (args.length === 0) {
    console.error("Uso: npm start -- <arquivos ou pasta>");
    process.exitCode = 1;
    return;
  }

  let arquivos: string[];
  try {
    arquivos = listarArquivos(args);
  } catch (erro) {
    console.error(`Entrada inválida: ${(erro as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (arquivos.length === 0) {
    console.error("Nenhum arquivo .txt encontrado.");
    process.exitCode = 1;
    return;
  }

  for (const arquivo of arquivos) {
    // Uma falha em um arquivo não impede a leitura dos demais.
    try {
      resumirArquivo(arquivo);
    } catch (erro) {
      console.error(`Falha ao ler ${arquivo}: ${(erro as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main(process.argv.slice(2));
