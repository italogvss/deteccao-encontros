import { classificarEncontro, OPCOES_PADRAO, type OpcoesClassificacao } from "./classifier";
import { distanciaHaversine, estaEmEncontro, LIMITE_DELTA_LAT_GRAUS } from "./geo";
import type { AoLerPosicao } from "./parser";
import type { DadosEntrada, Encontro, Pessoa, TipoEncontro } from "./types";

export interface ResultadoDeteccao {
  encontros: Encontro[];
  linhasInvalidas: number;
  /** Posições descartadas por repetir um ID dentro do mesmo timestamp. */
  posicoesRepetidas: number;
}

/**
 * Posições de um timestamp, em colunas: `ids[i]`, `lats[i]` e `lons[i]` são da mesma pessoa. Sem um
 * objeto por posição, o laço de pares lê doubles vizinhos na memória e o coletor de lixo tem bem menos
 * objetos para percorrer.
 */
interface GrupoPosicoes {
  ids: number[];
  lats: number[];
  lons: number[];
}

/**
 * Agrupa as posições por timestamp durante a leitura e só compara os pares no fim, com o cadastro
 * completo: o vínculo vítima ↔ agressor só fica pronto depois de ler o arquivo inteiro. A leitura vem
 * por parâmetro para o mesmo código servir a arquivos e a conteúdo em memória.
 *
 * Cada ID conta uma vez por timestamp e vale a primeira posição: com um repetido, a pessoa encontraria
 * a si mesma e o par seria registrado duas vezes.
 */
export function detectarEncontros(
  ler: (aoLerPosicao: AoLerPosicao) => DadosEntrada,
  opcoes: OpcoesClassificacao = OPCOES_PADRAO,
): ResultadoDeteccao {
  const grupos = new Map<string, GrupoPosicoes>();
  let posicoesRepetidas = 0;

  const { cadastro, linhasInvalidas } = ler(({ id, timestamp, lat, lon }) => {
    let grupo = grupos.get(timestamp);
    if (grupo === undefined) {
      grupo = { ids: [], lats: [], lons: [] };
      grupos.set(timestamp, grupo);
    }
    if (grupo.ids.includes(id)) {
      posicoesRepetidas++;
      return;
    }
    grupo.ids.push(id);
    grupo.lats.push(lat);
    grupo.lons.push(lon);
  });

  const encontros: Encontro[] = [];
  for (const [timestamp, grupo] of grupos) {
    compararGrupo(timestamp, grupo, cadastro, opcoes, encontros);
  }
  encontros.sort(compararEncontros);

  return { encontros, linhasInvalidas, posicoesRepetidas };
}

/**
 * Avalia cada par uma única vez (laço `i < j`). O filtro de latitude descarta quase todos os pares
 * sem calcular senos e cossenos.
 */
function compararGrupo(
  timestamp: string,
  grupo: GrupoPosicoes,
  cadastro: Map<number, Pessoa>,
  opcoes: OpcoesClassificacao,
  encontros: Encontro[],
): void {
  const { ids, lats, lons } = grupo;

  for (let i = 0; i < ids.length; i++) {
    const latI = lats[i];
    for (let j = i + 1; j < ids.length; j++) {
      if (Math.abs(latI - lats[j]) > LIMITE_DELTA_LAT_GRAUS) continue;

      const distanciaMetros = distanciaHaversine(latI, lons[i], lats[j], lons[j]);
      if (!estaEmEncontro(distanciaMetros)) continue;

      const tipo = classificarEncontro(cadastro.get(ids[i])!, cadastro.get(ids[j])!, opcoes);
      if (tipo !== null) encontros.push(criarEncontro(tipo, timestamp, grupo, i, j, distanciaMetros));
    }
  }
}

function criarEncontro(
  tipo: TipoEncontro,
  timestamp: string,
  { ids, lats, lons }: GrupoPosicoes,
  i: number,
  j: number,
  distanciaMetros: number,
): Encontro {
  return {
    tipo,
    monitoradosEncontro: ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]],
    timestamp,
    posicoes: {
      [ids[i]]: { lat: lats[i], lon: lons[i] },
      [ids[j]]: { lat: lats[j], lon: lons[j] },
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
