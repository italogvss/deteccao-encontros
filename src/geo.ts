export const RAIO_TERRA_METROS = 6_371_000;
export const LIMITE_ENCONTRO_METROS = 20;

/**
 * Diferença de latitude acima da qual dois pontos com certeza estão a 20 m ou mais (R·|Δφ| nunca
 * supera a distância real). 20 m equivalem a cerca de 0,00017986°, então 0,00018° é um limite seguro.
 */
export const LIMITE_DELTA_LAT_GRAUS = 0.00018;

function paraRadianos(graus: number): number {
  return (graus * Math.PI) / 180;
}

function senoAoQuadrado(angulo: number): number {
  const seno = Math.sin(angulo);
  return seno * seno;
}

/**
 * Distância em metros entre dois pontos, pela fórmula de Haversine. O resultado não é arredondado,
 * porque o gabarito usa a precisão completa do double.
 *
 * A ordem das operações é proposital: reorganizar a conta, mesmo mantendo a matemática, muda a última
 * casa decimal em alguns casos. Esta forma bate exatamente com todos os valores dos gabaritos.
 */
export function distanciaHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaPhi = paraRadianos(lat2 - lat1);
  const deltaLambda = paraRadianos(lon2 - lon1);

  const h =
    senoAoQuadrado(deltaPhi / 2) +
    Math.cos(paraRadianos(lat1)) * Math.cos(paraRadianos(lat2)) * senoAoQuadrado(deltaLambda / 2);

  return 2 * RAIO_TERRA_METROS * Math.asin(Math.sqrt(h));
}

/** O limite é estrito: exatamente 20 m não é encontro. */
export function estaEmEncontro(distanciaMetros: number): boolean {
  return distanciaMetros < LIMITE_ENCONTRO_METROS;
}
