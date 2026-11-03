export type TipoEncontro = "generico" | "faccao" | "protetiva";

/** Dados fixos de uma pessoa, independentes do timestamp. */
export interface Pessoa {
  id: number;
  /** `null` = sem facção. */
  idFaccao: number | null;
  ehVitima: boolean;
  /**
   * IDs ligados a esta pessoa por medida protetiva, nos dois sentidos: para a vítima, seus agressores;
   * para o agressor, suas vítimas. Assim basta uma consulta, seja qual for a ordem do par.
   */
  restricoes: Set<number>;
}

export interface Coordenadas {
  lat: number;
  lon: number;
}

/** Onde uma pessoa estava em um instante. */
export interface Posicao extends Coordenadas {
  id: number;
  timestamp: string;
}

export interface DadosEntrada {
  cadastro: Map<number, Pessoa>;
  /** Linhas descartadas por formato inválido. */
  linhasInvalidas: number;
}

/** Um registro do JSON de saída. */
export interface Encontro {
  tipo: TipoEncontro;
  /** IDs em ordem crescente. */
  monitoradosEncontro: [number, number];
  timestamp: string;
  posicoes: Record<string, Coordenadas>;
  distanciaMetros: number;
}
