import type { Pessoa, TipoEncontro } from "./types";

export interface OpcoesClassificacao {
  /** Registra como `generico` uma vítima perto de quem não é seu agressor. */
  incluirVitimaEmGenerico: boolean;
}

export const OPCOES_PADRAO: OpcoesClassificacao = { incluirVitimaEmGenerico: false };

/**
 * Tipo de um par que está a menos de 20 m, ou `null` se o par não deve ser registrado. A cascata de
 * `return`s garante um único tipo por par: o primeiro que casar vence.
 *
 * Basta consultar `a.restricoes` porque o vínculo vítima ↔ agressor é montado nos dois sentidos, e
 * facção vazia (`null`) não conta como "mesma facção".
 */
export function classificarEncontro(
  a: Pessoa,
  b: Pessoa,
  opcoes: OpcoesClassificacao = OPCOES_PADRAO,
): TipoEncontro | null {
  if (a.restricoes.has(b.id)) return "protetiva";
  if (a.idFaccao !== null && a.idFaccao === b.idFaccao) return "faccao";
  if (!a.ehVitima && !b.ehVitima) return "generico";
  return opcoes.incluirVitimaEmGenerico ? "generico" : null;
}
