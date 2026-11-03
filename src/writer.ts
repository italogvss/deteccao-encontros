import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Encontro } from "./types";

/** Grava com indentação de 2 espaços, o mesmo formato dos gabaritos, para a saída poder ser lida e comparada. */
export function gravarEncontros(caminho: string, encontros: Encontro[]): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, JSON.stringify(encontros, null, 2));
}
