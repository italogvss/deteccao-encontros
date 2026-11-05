import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { DadosEntrada, Pessoa, Posicao } from "./types";

const TAMANHO_BLOCO = 1024 * 1024;
const CABECALHO = "idMonitorado;";

const QUEBRA_DE_LINHA = 0x0a;
const ASPAS = 0x22;
const HIFEN = 0x2d;
const PONTO = 0x2e;
const DIGITO_0 = 0x30;
const DIGITO_9 = 0x39;
const PONTO_E_VIRGULA = 0x3b;

/** IDs a partir daqui continuam corretos, mas sempre pelo caminho lento. */
const LIMITE_ID_RAPIDO = 65_536;
const MAX_DIGITOS_EXATOS = 15;
const POTENCIAS_DE_10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

let fimDoUltimoDecimal = 0;

/**
 * Recebe as posições sem criar um objeto por linha. As posições seguintes pertencem ao último timestamp
 * informado; retornar `false` em `aoMudarTimestamp` interrompe a leitura.
 */
export interface ConsumidorPosicoes {
  aoMudarTimestamp(timestamp: string): boolean;
  aoLerPosicao(id: number, lat: number, lon: number): void;
}

/**
 * Lê um arquivo de qualquer tamanho, em blocos, e retorna `null` se o consumidor interromper a leitura.
 *
 * O byte extra no tamanho do bloco deixa espaço para detectar o fim do arquivo. Os bytes da linha
 * incompleta ficam no início do bloco à espera do restante, e só uma linha maior que o bloco o faz
 * crescer. O último trecho recebe uma quebra de linha, porque todo texto entregue ao leitor termina com
 * uma; há espaço para ela, já que o bloco cresce antes de cada leitura quando está cheio.
 */
export function lerArquivo(
  caminho: string,
  consumidor: ConsumidorPosicoes,
  tamanhoBloco: number = TAMANHO_BLOCO,
): DadosEntrada | null {
  const leitor = criarLeitor(consumidor);
  const arquivo = openSync(caminho, "r");

  try {
    let bloco = Buffer.allocUnsafe(Math.min(tamanhoBloco, fstatSync(arquivo).size + 1));
    let pendentes = 0;

    while (true) {
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

      if (!leitor.processarBytes(bloco, ultimaQuebra + 1)) return null;
      bloco.copy(bloco, 0, ultimaQuebra + 1, total);
      pendentes = total - ultimaQuebra - 1;
    }

    if (pendentes > 0) {
      bloco[pendentes] = QUEBRA_DE_LINHA;
      if (!leitor.processarBytes(bloco, pendentes + 1)) return null;
    }
  } finally {
    closeSync(arquivo);
  }

  return leitor.concluir();
}

/** Mesmo caminho do `lerArquivo`, para conteúdo já em memória. */
export function parsearConteudo(conteudo: string, consumidor: ConsumidorPosicoes): DadosEntrada | null {
  const leitor = criarLeitor(consumidor);
  const bytes = Buffer.from(`${conteudo}\n`);
  return leitor.processarBytes(bytes, bytes.length) ? leitor.concluir() : null;
}

function criarLeitor(consumidor: ConsumidorPosicoes) {
  const cadastro = new Map<number, Pessoa>();
  const idsConhecidos = new Uint8Array(LIMITE_ID_RAPIDO);
  let timestampAtual = "";
  let bytesTimestamp: Buffer = Buffer.alloc(0);
  let linhasInvalidas = 0;

  /**
   * Caminho rápido: lê a linha direto dos bytes, sem criar nenhuma string, e retorna onde começa a próxima.
   * Só aceita uma pessoa já cadastrada, no timestamp atual e com coordenadas no formato simples. Qualquer
   * outro caso retorna -1, e a linha passa pelo caminho lento, que decide se ela é válida.
   */
  function processarLinhaRapida(bytes: Buffer, inicio: number): number {
    const fimId = fimDoCampo(bytes, inicio);
    if (fimId < 0) return -1;
    const id = lerInteiro(bytes, inicio, fimId);
    if (id < 0 || id >= LIMITE_ID_RAPIDO || idsConhecidos[id] === 0) return -1;

    const fimFaccao = fimDoCampo(bytes, fimId + 1);
    if (fimFaccao < 0 || !ehTimestamp(bytes, fimFaccao + 1, bytesTimestamp)) return -1;

    const lat = lerDecimal(bytes, fimFaccao + bytesTimestamp.length + 4);
    if (!(Math.abs(lat) <= 90)) return -1;

    const lon = lerDecimal(bytes, fimDoUltimoDecimal + 1);
    if (!(Math.abs(lon) <= 180)) return -1;

    consumidor.aoLerPosicao(id, lat, lon);
    return fimDaLinha(bytes, fimDoUltimoDecimal + 1) + 1;
  }

  /**
   * Caminho lento: valida a linha inteira como texto. Trata o cabeçalho, a primeira linha de cada ID, a
   * troca de timestamp e qualquer formato incomum. O `trim` remove o `\r`, os espaços e o BOM. Retorna
   * `false` se o consumidor interromper a leitura.
   */
  function processarLinhaLenta(linhaBruta: string): boolean {
    const linha = linhaBruta.trim();
    if (linha === "" || linha.startsWith(CABECALHO)) return true;

    const posicao = parsearPosicao(linha);
    if (posicao === null) {
      linhasInvalidas++;
      return true;
    }

    if (!cadastro.has(posicao.id)) {
      const pessoa = parsearPessoa(posicao.id, linha);
      if (pessoa === null) {
        linhasInvalidas++;
        return true;
      }
      cadastro.set(posicao.id, pessoa);
      if (posicao.id < LIMITE_ID_RAPIDO) idsConhecidos[posicao.id] = 1;
    }

    if (posicao.timestamp !== timestampAtual) {
      timestampAtual = posicao.timestamp;
      bytesTimestamp = Buffer.from(timestampAtual);
      if (!consumidor.aoMudarTimestamp(timestampAtual)) return false;
    }

    consumidor.aoLerPosicao(posicao.id, posicao.lat, posicao.lon);
    return true;
  }

  return {
    /** `bytes[limite - 1]` precisa ser uma quebra de linha. Retorna `false` se a leitura for interrompida. */
    processarBytes(bytes: Buffer, limite: number): boolean {
      let inicio = 0;
      while (inicio < limite) {
        const proxima = processarLinhaRapida(bytes, inicio);
        if (proxima >= 0) {
          inicio = proxima;
          continue;
        }

        const fim = fimDaLinha(bytes, inicio);
        if (!processarLinhaLenta(bytes.toString("utf8", inicio, fim))) return false;
        inicio = fim + 1;
      }
      return true;
    },

    concluir(): DadosEntrada {
      completarVinculos(cadastro);
      return { cadastro, linhasInvalidas };
    },
  };
}

/** Posição do próximo `;`, ou -1 se a linha acabar antes. A quebra de linha final garante que o laço termina. */
function fimDoCampo(bytes: Buffer, inicio: number): number {
  for (let i = inicio; ; i++) {
    const byte = bytes[i];
    if (byte === PONTO_E_VIRGULA) return i;
    if (byte === QUEBRA_DE_LINHA) return -1;
  }
}

function fimDaLinha(bytes: Buffer, inicio: number): number {
  let i = inicio;
  while (bytes[i] !== QUEBRA_DE_LINHA) i++;
  return i;
}

/** Retorna -1 se o trecho estiver vazio ou tiver algo além de dígitos. */
function lerInteiro(bytes: Buffer, inicio: number, fim: number): number {
  if (inicio === fim) return -1;

  let valor = 0;
  for (let i = inicio; i < fim; i++) {
    const byte = bytes[i];
    if (byte < DIGITO_0 || byte > DIGITO_9) return -1;
    valor = valor * 10 + (byte - DIGITO_0);
  }
  return valor;
}

/**
 * Lê um decimal simples terminado em `;` (`-13.06443;`) e retorna NaN para qualquer outro formato. Dá o
 * mesmo double que `Number()`: com até 15 dígitos, a mantissa e a potência de 10 são exatas em double, e a
 * divisão IEEE arredonda corretamente o quociente.
 *
 * Grava a posição do `;` em `fimDoUltimoDecimal`, para quem chama não percorrer o campo duas vezes:
 * retornar os dois valores em um objeto criaria uma alocação por coordenada.
 */
function lerDecimal(bytes: Buffer, inicio: number): number {
  const negativo = bytes[inicio] === HIFEN;
  let mantissa = 0;
  let digitos = 0;
  let casas = 0;
  let depoisDoPonto = false;
  let i = negativo ? inicio + 1 : inicio;

  for (; ; i++) {
    const byte = bytes[i];
    if (byte >= DIGITO_0 && byte <= DIGITO_9) {
      mantissa = mantissa * 10 + (byte - DIGITO_0);
      digitos++;
      if (depoisDoPonto) casas++;
    } else if (byte === PONTO && !depoisDoPonto) {
      depoisDoPonto = true;
    } else if (byte === PONTO_E_VIRGULA) {
      break;
    } else {
      return NaN;
    }
  }

  if (digitos === 0 || digitos > MAX_DIGITOS_EXATOS) return NaN;
  fimDoUltimoDecimal = i;
  const valor = mantissa / POTENCIAS_DE_10[casas];
  return negativo ? -valor : valor;
}

/** Confere o campo `"<timestamp>";`. Os segundos ficam no fim, então comparar de trás para frente falha mais cedo. */
function ehTimestamp(bytes: Buffer, inicio: number, timestamp: Buffer): boolean {
  const tamanho = timestamp.length;
  if (bytes[inicio] !== ASPAS || bytes[inicio + tamanho + 1] !== ASPAS || bytes[inicio + tamanho + 2] !== PONTO_E_VIRGULA) {
    return false;
  }

  for (let i = tamanho - 1; i >= 0; i--) {
    if (bytes[inicio + 1 + i] !== timestamp[i]) return false;
  }
  return true;
}

/**
 * Lê só os campos que mudam a cada linha, no caminho lento. O teste de `Math.abs` é escrito pela positiva
 * porque NaN falha em qualquer comparação, inclusive nessa.
 */
function parsearPosicao(linha: string): Posicao | null {
  const fimId = linha.indexOf(";");
  const fimFaccao = linha.indexOf(";", fimId + 1);
  const fimTimestamp = linha.indexOf(";", fimFaccao + 1);
  const fimLat = linha.indexOf(";", fimTimestamp + 1);
  const fimLon = linha.indexOf(";", fimLat + 1);
  if (fimId < 0 || fimFaccao < 0 || fimTimestamp < 0 || fimLat < 0 || fimLon < 0) return null;

  const id = lerNumero(linha.slice(0, fimId));
  if (!ehIdValido(id)) return null;

  const lat = lerNumero(linha.slice(fimTimestamp + 1, fimLat));
  const lon = lerNumero(linha.slice(fimLat + 1, fimLon));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;

  const timestamp = removerAspas(linha.slice(fimFaccao + 1, fimTimestamp));
  if (timestamp === "") return null;

  return { id, timestamp, lat, lon };
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

/** `Number("")` e `Number(" ")` valem 0: sem este teste, um campo vazio viraria uma coordenada real. */
function lerNumero(campo: string): number {
  return campo.trim() === "" ? NaN : Number(campo);
}

function ehIdValido(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 0;
}

function removerAspas(campo: string): string {
  return campo.length >= 2 && campo.startsWith('"') && campo.endsWith('"') ? campo.slice(1, -1) : campo;
}
