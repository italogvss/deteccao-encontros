import { readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { OpcoesClassificacao } from "./classifier";
import { detectarEncontros } from "./detector";
import { lerArquivo } from "./parser";
import type { TipoEncontro } from "./types";
import { gravarEncontros } from "./writer";

/** Resolvida a partir do código compilado (`dist/src`), para o resultado ir sempre para o mesmo lugar. */
const PASTA_SAIDA = join(__dirname, "..", "..", "output");
const OPCAO_VITIMA = "--incluir-vitima-em-generico";

/** Um caminho inexistente passa adiante como arquivo, e a falha aparece ao tentar lê-lo. */
function listarArquivos(entrada: string): string[] {
  if (!statSync(entrada, { throwIfNoEntry: false })?.isDirectory()) return [entrada];
  return readdirSync(entrada)
    .filter((nome) => nome.endsWith(".txt"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((nome) => join(entrada, nome));
}

/** O tempo cobre leitura, detecção e gravação; não inclui a inicialização do Node nem o terminal. */
function processarArquivo(caminho: string, opcoes: OpcoesClassificacao): void {
  const nome = basename(caminho, extname(caminho));
  const inicio = performance.now();
  const { encontros, linhasInvalidas, posicoesRepetidas } = detectarEncontros(
    (aoLerPosicao) => lerArquivo(caminho, aoLerPosicao),
    opcoes,
  );
  gravarEncontros(join(PASTA_SAIDA, `${nome}.json`), encontros);
  const tempoMs = performance.now() - inicio;

  const porTipo: Record<TipoEncontro, number> = { generico: 0, faccao: 0, protetiva: 0 };
  for (const { tipo } of encontros) porTipo[tipo]++;

  console.log(
    `${nome}: ${encontros.length} encontros (generico: ${porTipo.generico}, faccao: ${porTipo.faccao}, ` +
      `protetiva: ${porTipo.protetiva}) em ${Math.round(tempoMs)} ms ` +
      `[linhas inválidas: ${linhasInvalidas}, posições repetidas: ${posicoesRepetidas}]`,
  );
}

/**
 * Opção desconhecida gera erro, para um erro de digitação não produzir silenciosamente um resultado
 * diferente. Uma falha em um arquivo não impede o processamento dos demais.
 */
function main(args: string[]): void {
  const opcoesDesconhecidas = args.filter((arg) => arg.startsWith("--") && arg !== OPCAO_VITIMA);
  const entradas = args.filter((arg) => !arg.startsWith("--"));
  const arquivos = entradas.flatMap(listarArquivos);

  if (opcoesDesconhecidas.length > 0 || arquivos.length === 0) {
    console.error(`Uso: npm start -- <arquivos ou pasta> [${OPCAO_VITIMA}]`);
    process.exitCode = 1;
    return;
  }

  const opcoes = { incluirVitimaEmGenerico: args.includes(OPCAO_VITIMA) };
  for (const arquivo of arquivos) {
    try {
      processarArquivo(arquivo, opcoes);
    } catch (erro) {
      console.error(`Falha ao processar ${arquivo}: ${(erro as Error).message}`);
      process.exitCode = 1;
    }
  }
}

main(process.argv.slice(2));
