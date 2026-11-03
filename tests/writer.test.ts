import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Encontro } from "../src/types";
import { gravarEncontros } from "../src/writer";

test("cria a pasta e grava o JSON no formato do gabarito", () => {
  const encontros: Encontro[] = [
    {
      tipo: "faccao",
      monitoradosEncontro: [7, 8],
      timestamp: "2024-01-01 00:36:00",
      posicoes: { "7": { lat: -13.02054, lon: -46.40609 }, "8": { lat: -13.02046, lon: -46.40609 } },
      distanciaMetros: 8.895594131622975,
    },
  ];

  const pasta = mkdtempSync(join(tmpdir(), "writer-"));
  try {
    const caminho = join(pasta, "nova", "saida.json");
    gravarEncontros(caminho, encontros);

    assert.equal(readFileSync(caminho, "utf8"), JSON.stringify(encontros, null, 2));
    assert.deepEqual(JSON.parse(readFileSync(caminho, "utf8")), encontros);
  } finally {
    rmSync(pasta, { recursive: true });
  }
});
