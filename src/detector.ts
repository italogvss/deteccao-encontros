import { classificarEncontro, OPCOES_PADRAO, type OpcoesClassificacao } from "./classifier";
import { distanciaHaversine, estaEmEncontro, LIMITE_DELTA_LAT_GRAUS } from "./geo";
import type { ConsumidorPosicoes } from "./parser";
import type { DadosEntrada, Encontro } from "./types";

const CAPACIDADE_INICIAL = 16;
const LIMITE_ID_TABELA = 65_536;

export interface ResultadoDeteccao {
  encontros: Encontro[];
  linhasInvalidas: number;
  /** Posições descartadas por repetir um ID dentro do mesmo timestamp. */
  posicoesRepetidas: number;
}

type LeituraPosicoes = (consumidor: ConsumidorPosicoes) => DadosEntrada | null;

/** Par a menos de 20 m, ainda sem tipo: classificar exige o cadastro completo. */
type Candidato = Omit<Encontro, "tipo">;

interface Deteccao {
  dados: DadosEntrada;
  comparador: ComparadorDeGrupos;
}

/** Posições de um timestamp, em colunas: `ids[i]`, `lats[i]` e `lons[i]` são da mesma pessoa. */
class GrupoPosicoes {
  tamanho = 0;
  ids = new Float64Array(CAPACIDADE_INICIAL);
  lats = new Float64Array(CAPACIDADE_INICIAL);
  lons = new Float64Array(CAPACIDADE_INICIAL);

  adicionar(id: number, lat: number, lon: number): void {
    if (this.tamanho === this.ids.length) this.crescer();
    this.ids[this.tamanho] = id;
    this.lats[this.tamanho] = lat;
    this.lons[this.tamanho] = lon;
    this.tamanho++;
  }

  private crescer(): void {
    const dobrar = (coluna: Float64Array) => {
      const maior = new Float64Array(coluna.length * 2);
      maior.set(coluna);
      return maior;
    };
    this.ids = dobrar(this.ids);
    this.lats = dobrar(this.lats);
    this.lons = dobrar(this.lons);
  }
}

/** Compara grupos e acumula os candidatos. Reaproveita a ordem por latitude entre um timestamp e o seguinte. */
class ComparadorDeGrupos {
  readonly candidatos: Candidato[] = [];
  posicoesRepetidas = 0;

  private ordem = new Int32Array(CAPACIDADE_INICIAL);
  private tamanhoOrdem = 0;
  private readonly marcas = new Int32Array(LIMITE_ID_TABELA);
  private readonly idsAltos = new Set<number>();
  private grupoAtual = 0;

  comparar(timestamp: string, grupo: GrupoPosicoes): void {
    this.removerRepetidos(grupo);
    this.prepararOrdem(grupo.tamanho);
    ordenarPorLatitude(this.ordem, grupo);
    this.varrerVizinhos(timestamp, grupo);
  }

  /**
   * Cada ID conta uma vez por timestamp e vale a primeira posição: com um repetido, a pessoa encontraria a
   * si mesma e o par seria registrado duas vezes. A tabela marca o último grupo em que cada ID apareceu,
   * sem precisar ser limpa entre os grupos. IDs altos demais para a tabela ficam em um `Set`.
   */
  private removerRepetidos(grupo: GrupoPosicoes): void {
    const { ids, lats, lons, tamanho } = grupo;
    this.grupoAtual++;
    this.idsAltos.clear();

    let mantidos = 0;
    for (let i = 0; i < tamanho; i++) {
      if (this.jaApareceu(ids[i])) {
        this.posicoesRepetidas++;
        continue;
      }
      ids[mantidos] = ids[i];
      lats[mantidos] = lats[i];
      lons[mantidos] = lons[i];
      mantidos++;
    }
    grupo.tamanho = mantidos;
  }

  private jaApareceu(id: number): boolean {
    if (id < LIMITE_ID_TABELA) {
      if (this.marcas[id] === this.grupoAtual) return true;
      this.marcas[id] = this.grupoAtual;
      return false;
    }
    if (this.idsAltos.has(id)) return true;
    this.idsAltos.add(id);
    return false;
  }

  /** Mesmo tamanho do grupo anterior: mantém a ordem, que já está quase certa. Caso contrário, recomeça. */
  private prepararOrdem(tamanho: number): void {
    if (tamanho === this.tamanhoOrdem) return;
    if (tamanho > this.ordem.length) this.ordem = new Int32Array(tamanho * 2);
    for (let i = 0; i < tamanho; i++) this.ordem[i] = i;
    this.tamanhoOrdem = tamanho;
  }

  /**
   * Com o grupo ordenado por latitude, a busca de cada pessoa para no primeiro vizinho além do limite,
   * porque todos os seguintes estão ainda mais longe. Cada par continua avaliado uma única vez (`i < j`).
   */
  private varrerVizinhos(timestamp: string, grupo: GrupoPosicoes): void {
    const { ordem } = this;
    const { lats, lons, tamanho } = grupo;

    for (let i = 0; i < tamanho; i++) {
      const a = ordem[i];
      const latA = lats[a];
      for (let j = i + 1; j < tamanho; j++) {
        const b = ordem[j];
        if (lats[b] - latA > LIMITE_DELTA_LAT_GRAUS) break;

        const distanciaMetros = distanciaHaversine(latA, lons[a], lats[b], lons[b]);
        if (estaEmEncontro(distanciaMetros)) {
          this.candidatos.push(criarCandidato(timestamp, grupo, a, b, distanciaMetros));
        }
      }
    }
  }
}

/**
 * Tenta primeiro o caminho que compara cada timestamp assim que ele termina, sem guardar o arquivo na
 * memória. Se o arquivo não estiver em ordem, a leitura é interrompida e recomeça guardando tudo. Assim,
 * o resultado nunca depende da ordem das linhas.
 *
 * A classificação fica para o fim porque o vínculo vítima ↔ agressor só fica completo depois de ler o
 * arquivo inteiro. A leitura vem por parâmetro para o mesmo código servir a arquivos e a conteúdo em memória.
 */
export function detectarEncontros(
  ler: LeituraPosicoes,
  opcoes: OpcoesClassificacao = OPCOES_PADRAO,
): ResultadoDeteccao {
  const { dados, comparador } = detectarEmOrdem(ler) ?? detectarForaDeOrdem(ler);
  const { cadastro, linhasInvalidas } = dados;

  const encontros: Encontro[] = [];
  for (const candidato of comparador.candidatos) {
    const [menor, maior] = candidato.monitoradosEncontro;
    const tipo = classificarEncontro(cadastro.get(menor)!, cadastro.get(maior)!, opcoes);
    if (tipo !== null) encontros.push({ tipo, ...candidato });
  }
  encontros.sort(compararEncontros);

  return { encontros, linhasInvalidas, posicoesRepetidas: comparador.posicoesRepetidas };
}

/**
 * Timestamps estritamente crescentes não se repetem, então um grupo que terminou não recebe mais posições.
 * Um timestamp menor que o anterior interrompe a leitura, e o resultado é `null`. O texto vazio serve de
 * "nenhum timestamp ainda" porque o parser nunca entrega um timestamp vazio.
 */
function detectarEmOrdem(ler: LeituraPosicoes): Deteccao | null {
  const comparador = new ComparadorDeGrupos();
  const grupo = new GrupoPosicoes();
  let timestamp = "";

  const dados = ler({
    aoMudarTimestamp(novo) {
      if (novo < timestamp) return false;
      if (timestamp !== "") comparador.comparar(timestamp, grupo);
      grupo.tamanho = 0;
      timestamp = novo;
      return true;
    },
    aoLerPosicao(id, lat, lon) {
      grupo.adicionar(id, lat, lon);
    },
  });
  if (dados === null) return null;

  if (timestamp !== "") comparador.comparar(timestamp, grupo);
  return { dados, comparador };
}

/** Caminho de reserva, para arquivo fora de ordem: guarda os grupos e só compara depois de ler tudo. */
function detectarForaDeOrdem(ler: LeituraPosicoes): Deteccao {
  const grupos = new Map<string, GrupoPosicoes>();
  let grupo = new GrupoPosicoes();

  const dados = ler({
    aoMudarTimestamp(novo) {
      let existente = grupos.get(novo);
      if (existente === undefined) {
        existente = new GrupoPosicoes();
        grupos.set(novo, existente);
      }
      grupo = existente;
      return true;
    },
    aoLerPosicao(id, lat, lon) {
      grupo.adicionar(id, lat, lon);
    },
  })!;

  const comparador = new ComparadorDeGrupos();
  for (const [timestamp, existente] of grupos) comparador.comparar(timestamp, existente);
  return { dados, comparador };
}

/**
 * Ordenação por inserção, sobre os índices. As pessoas se movem pouco em 5 segundos, então a ordem do
 * timestamp anterior já está quase certa e o custo fica perto de O(n). No pior caso é O(n²), o mesmo de
 * comparar todos os pares.
 */
function ordenarPorLatitude(ordem: Int32Array, { lats, tamanho }: GrupoPosicoes): void {
  for (let i = 1; i < tamanho; i++) {
    const atual = ordem[i];
    const latAtual = lats[atual];

    let j = i - 1;
    while (j >= 0 && lats[ordem[j]] > latAtual) {
      ordem[j + 1] = ordem[j];
      j--;
    }
    ordem[j + 1] = atual;
  }
}

function criarCandidato(
  timestamp: string,
  { ids, lats, lons }: GrupoPosicoes,
  a: number,
  b: number,
  distanciaMetros: number,
): Candidato {
  const [menor, maior] = ids[a] < ids[b] ? [a, b] : [b, a];
  return {
    monitoradosEncontro: [ids[menor], ids[maior]],
    timestamp,
    posicoes: {
      [ids[menor]]: { lat: lats[menor], lon: lons[menor] },
      [ids[maior]]: { lat: lats[maior], lon: lons[maior] },
    },
    distanciaMetros,
  };
}

/** Timestamps no formato do arquivo ordenam corretamente como texto; os IDs desempatam. */
function compararEncontros(a: Encontro, b: Encontro): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  const [a1, a2] = a.monitoradosEncontro;
  const [b1, b2] = b.monitoradosEncontro;
  return a1 - b1 || a2 - b2;
}
