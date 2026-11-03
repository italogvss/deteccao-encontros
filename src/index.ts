import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { detectarEncontros } from "./detector";
import { lerArquivo } from "./parser";

/** Um caminho inexistente passa adiante como arquivo, e a falha aparece ao tentar lê-lo. */
function listarArquivos(entrada: string): string[] {
  if (!statSync(entrada, { throwIfNoEntry: false })?.isDirectory()) return [entrada];
  return readdirSync(entrada)
    .filter((nome) => nome.endsWith(".txt"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((nome) => join(entrada, nome));
}

/** Por enquanto só imprime os encontros, para testar o detector e o classificador. */
function processarArquivo(caminho: string): void {
  const inicio = performance.now();
  const { encontros, linhasInvalidas, posicoesRepetidas } = detectarEncontros((aoLerPosicao) =>
    lerArquivo(caminho, aoLerPosicao),
  );
  const tempoMs = performance.now() - inicio;

  console.log(
    `${basename(caminho)}: ${encontros.length} encontros em ${Math.round(tempoMs)} ms ` +
      `(linhas inválidas: ${linhasInvalidas}, posições repetidas: ${posicoesRepetidas})`,
  );
  for (const { tipo, monitoradosEncontro, timestamp, distanciaMetros } of encontros) {
    console.log(`  ${timestamp}  ${tipo.padEnd(9)} ${monitoradosEncontro.join("-").padEnd(8)} ${distanciaMetros} m`);
  }
}

/** Uma falha em um arquivo não impede o processamento dos demais. */
function main(args: string[]): void {
  if (args.length === 0) {
    console.error("Uso: npm start -- <arquivos ou pasta>");
    process.exitCode = 1;
    return;
  }

  for (const arquivo of args.flatMap(listarArquivos)) {
    try {
      processarArquivo(arquivo);
    } catch (erro) {
      console.error(`Falha ao processar ${arquivo}: ${(erro as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main(process.argv.slice(2));
