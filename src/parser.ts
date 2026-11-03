import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { DadosEntrada, Pessoa, Posicao } from "./types";

/** O limite de string do Node é ~512 MB: ler em blocos é o que permite abrir arquivos maiores que isso. */
const TAMANHO_BLOCO = 64 * 1024 * 1024;
const QUEBRA_DE_LINHA = 0x0a;
const ASPAS = 0x22;
const CABECALHO = "idMonitorado;";

/** Chamado uma vez por linha válida. O parser não acumula posições: a memória não cresce com o arquivo. */
export type AoLerPosicao = (posicao: Posicao) => void;

/** Lê um arquivo de qualquer tamanho, em blocos. */
export function lerArquivo(
  caminho: string,
  aoLerPosicao: AoLerPosicao,
  tamanhoBloco: number = TAMANHO_BLOCO,
): DadosEntrada {
  const leitor = criarLeitor(aoLerPosicao);
  const arquivo = openSync(caminho, "r");

  try {
    // Alocar 64 MB custa mais que ler um arquivo pequeno inteiro. O byte extra deixa espaço para detectar o fim
    // do arquivo sem fazer o bloco crescer à toa.
    let bloco = Buffer.allocUnsafe(Math.min(tamanhoBloco, fstatSync(arquivo).size + 1));
    // Bytes da linha incompleta guardados no início do bloco, à espera do restante.
    let pendentes = 0;

    while (true) {
      // Só uma linha maior que o bloco inteiro chega aqui. Crescer evita perder essa linha.
      if (pendentes === bloco.length) {
        const maior = Buffer.allocUnsafe(bloco.length * 2);
        bloco.copy(maior, 0, 0, pendentes);
        bloco = maior;
      }

      const lidos = readSync(arquivo, bloco, pendentes, bloco.length - pendentes, null);
      if (lidos === 0) break;

      const total = pendentes + lidos;
      const ultimaQuebra = bloco.lastIndexOf(QUEBRA_DE_LINHA, total - 1);
      if (ultimaQuebra === -1) {
        pendentes = total;
        continue;
      }

      // Cortar na quebra de linha também protege os caracteres UTF-8: o byte 0x0a nunca faz parte de um deles.
      leitor.processarTexto(bloco.toString("utf8", 0, ultimaQuebra + 1));
      bloco.copy(bloco, 0, ultimaQuebra + 1, total);
      pendentes = total - ultimaQuebra - 1;
    }

    // A última linha pode não terminar com quebra de linha.
    if (pendentes > 0) leitor.processarTexto(bloco.toString("utf8", 0, pendentes));
  } finally {
    closeSync(arquivo);
  }

  return leitor.concluir();
}

/** Mesmo caminho do `lerArquivo`, para conteúdo já em memória. */
export function parsearConteudo(conteudo: string, aoLerPosicao: AoLerPosicao): DadosEntrada {
  const leitor = criarLeitor(aoLerPosicao);
  leitor.processarTexto(conteudo);
  return leitor.concluir();
}

function criarLeitor(aoLerPosicao: AoLerPosicao) {
  const cadastro = new Map<number, Pessoa>();
  const timestamps = criarTabelaTimestamps();
  let linhasInvalidas = 0;

  function processarLinha(linhaBruta: string): void {
    // O `trim` remove o `\r`, os espaços e o BOM do início do arquivo.
    const linha = linhaBruta.trim();
    // O cabeçalho é reconhecido pelo conteúdo: um arquivo sem cabeçalho não perde a primeira linha de dados.
    if (linha === "" || linha.startsWith(CABECALHO)) return;

    const posicao = parsearPosicao(linha, timestamps);
    if (posicao === null) {
      linhasInvalidas++;
      return;
    }

    // Os dados da pessoa são fixos por ID, então só são lidos na primeira linha válida do ID.
    if (!cadastro.has(posicao.id)) {
      const pessoa = parsearPessoa(posicao.id, linha);
      if (pessoa === null) {
        linhasInvalidas++;
        return;
      }
      cadastro.set(posicao.id, pessoa);
    }

    aoLerPosicao(posicao);
  }

  return {
    processarTexto(texto: string): void {
      let inicio = 0;
      while (inicio < texto.length) {
        const quebra = texto.indexOf("\n", inicio);
        const fim = quebra === -1 ? texto.length : quebra;
        processarLinha(texto.slice(inicio, fim));
        inicio = fim + 1;
      }
    },

    concluir(): DadosEntrada {
      completarVinculos(cadastro);
      return { cadastro, linhasInvalidas };
    },
  };
}

/**
 * Lê só os campos que mudam a cada linha. Usa `indexOf` em vez de `split` porque esta função roda em
 * todas as linhas e não precisa dos campos do fim.
 */
function parsearPosicao(linha: string, timestamps: TabelaTimestamps): Posicao | null {
  const fimId = linha.indexOf(";");
  const fimFaccao = linha.indexOf(";", fimId + 1);
  const fimTimestamp = linha.indexOf(";", fimFaccao + 1);
  const fimLatitude = linha.indexOf(";", fimTimestamp + 1);
  const fimLongitude = linha.indexOf(";", fimLatitude + 1);

  // Um `indexOf` que falha devolve -1 e o seguinte recomeça do início da linha, quebrando esta ordem crescente.
  const temTodosOsCampos =
    fimId !== -1 &&
    fimId < fimFaccao &&
    fimFaccao < fimTimestamp &&
    fimTimestamp < fimLatitude &&
    fimLatitude < fimLongitude;
  if (!temTodosOsCampos) return null;

  const id = lerNumero(linha.slice(0, fimId));
  if (!ehIdValido(id)) return null;

  const lat = lerNumero(linha.slice(fimTimestamp + 1, fimLatitude));
  const lon = lerNumero(linha.slice(fimLatitude + 1, fimLongitude));
  // Escrito assim porque NaN falha em qualquer comparação, inclusive nesta.
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;

  const timestamp = removerAspas(linha.slice(fimFaccao + 1, fimTimestamp));
  if (timestamp === "") return null;

  return { id, timestamp: timestamps.obter(timestamp), coordenadas: { lat, lon } };
}

/** Lê os dados fixos da pessoa. Aqui o `split` cabe: só roda na primeira ocorrência de cada ID. */
function parsearPessoa(id: number, linha: string): Pessoa | null {
  const [, faccao, , , , medida, idsRestricao = ""] = linha.split(";");

  const idFaccao = faccao.trim() === "" ? null : lerNumero(faccao);
  if (idFaccao !== null && !ehIdValido(idFaccao)) return null;

  const medidaProtetiva = medida.trim();
  if (medidaProtetiva !== "true" && medidaProtetiva !== "false") return null;
  const ehVitima = medidaProtetiva === "true";

  const restricoes = new Set<number>();
  if (ehVitima) {
    for (const campo of removerAspas(idsRestricao.trim()).split(",")) {
      if (campo.trim() === "") continue;
      const agressor = lerNumero(campo);
      if (!ehIdValido(agressor)) return null;
      restricoes.add(agressor);
    }
  }

  return { id, idFaccao, ehVitima, restricoes };
}

/**
 * Completa o sentido agressor → vítima. Só pode ser feito no fim, porque o agressor pode aparecer no
 * arquivo depois da vítima. Agressor que nunca aparece no arquivo não tem como encontrar ninguém.
 */
function completarVinculos(cadastro: Map<number, Pessoa>): void {
  for (const pessoa of cadastro.values()) {
    if (!pessoa.ehVitima) continue;
    for (const agressor of pessoa.restricoes) {
      cadastro.get(agressor)?.restricoes.add(pessoa.id);
    }
  }
}

interface TabelaTimestamps {
  obter(timestamp: string): string;
}

/**
 * Guarda uma única cópia de cada timestamp. Um `slice` mantém viva a string de origem, então guardar o
 * timestamp recortado prenderia o bloco inteiro de 64 MB na memória enquanto a posição existir.
 */
function criarTabelaTimestamps(): TabelaTimestamps {
  const copias = new Map<string, string>();
  let ultimo = "";

  return {
    obter(timestamp: string): string {
      // Atalho: as linhas de um mesmo timestamp costumam estar juntas.
      if (timestamp === ultimo) return ultimo;

      let copia = copias.get(timestamp);
      if (copia === undefined) {
        copia = Buffer.from(timestamp).toString();
        copias.set(copia, copia);
      }
      ultimo = copia;
      return copia;
    },
  };
}

/** `Number("")` e `Number(" ")` valem 0: sem este teste, um campo vazio viraria uma coordenada real. */
function lerNumero(campo: string): number {
  return campo.trim() === "" ? NaN : Number(campo);
}

function ehIdValido(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 0;
}

function removerAspas(campo: string): string {
  const entreAspas =
    campo.length >= 2 && campo.charCodeAt(0) === ASPAS && campo.charCodeAt(campo.length - 1) === ASPAS;
  return entreAspas ? campo.slice(1, -1) : campo;
}
