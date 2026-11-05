## Como executar

Requer Node.js 24 ou superior. Os datasets não ficam no repositório: coloque os `.txt` em `data/input/`.

```bash
npm ci
npm run build
npm start -- data/input        # grava os JSONs em output/
npm test
```

`npm start` também aceita arquivos individuais e não recompila, para não pesar nas medições.

Por padrão, uma vítima perto de quem não é seu agressor não é registrada (ver [Decisões de regra](#decisões-de-regra)). Para registrar esse caso como `generico`, use a opção abaixo. Ela grava nos mesmos arquivos de `output/`, então rode de novo sem ela para voltar ao resultado padrão.

```bash
npm start -- data/input --incluir-vitima-em-generico
```

## Lógica e Arquitetura

```
arquivo .txt
  → parser.ts      lê e valida as linhas e monta o cadastro de pessoas
  → detector.ts    agrupa e encontra os pares próximos
      → geo.ts         filtro de latitude + Haversine + limite estrito de 20 m
      → classifier.ts  classifica os encontros
  → writer.ts      grava output/<dataset>.json
```

1. **Leitura.** O arquivo é lido em blocos de 1 MB. As linhas comuns são lidas direto dos bytes. O cabeçalho, a primeira linha de cada ID e qualquer formato incomum passam por um caminho mais lento, com validação completa.
2. **Agrupamento.** Quando o timestamp muda, o grupo anterior está completo e é comparado. Assim, o arquivo não fica inteiro na memória. Isso garante que só posições do mesmo instante são comparadas.
3. **Comparação.** O grupo é ordenado por latitude, e a busca de cada pessoa para no primeiro vizinho a mais de 0,00018° (≈ 20 m). Só os pares restantes passam pelo Haversine (R = 6.371.000 m, sem arredondar).
4. **Classificação.** Fica para o fim, porque o vínculo vítima ↔ agressor só está completo depois de ler o arquivo inteiro. Um par é classificado pela cascata:
   - `protetiva`: um é vítima e o outro é seu agressor, em qualquer ordem;
   - `faccao`: os dois têm a mesma facção preenchida;
   - `generico`: nenhum dos dois é vítima;
   - caso contrário, o par é ignorado.

## Por que esta é a melhor abordagem

- **Agrupamento por timestamp.** Só existe encontro entre posições do mesmo timestamp, então comparar fora do grupo é trabalho perdido. No dataset 7, com 12 milhões de posições, o agrupamento reduz cerca de 72 trilhões de pares possíveis para 714 milhões, antes mesmo da varredura por latitude. O timestamp fica como texto, sem `Date`, porque serve só de chave e o formato já ordena corretamente.
- **Laço `i < j` para garantir a unicidade.** O índice `j` começa em `i + 1`, então cada par é avaliado uma única vez e ninguém é comparado consigo mesmo. A unicidade vem da própria estrutura do laço e dispensa uma deduplicação posterior. Um ID repetido no mesmo timestamp é removido antes da comparação, e vale a primeira posição.
- **Sem framework.** A solução é um processamento em lote: lê arquivos e grava JSON, sem servidor nem rotas para um framework web organizar. Só usa módulos nativos do Node em tempo de execução. `typescript` e `@types/node` são dependências de desenvolvimento, e os testes usam `node:test`. Sem biblioteca de CSV, o parser pode ler os bytes direto, e essa é a otimização que mais pesa: retirá-la multiplica a soma dos tempos por 5.

Na minha máquina, o dataset 7 roda em cerca de 1,5 s, com pico de 47 MB de memória, e os datasets 1 e 2 saem idênticos aos gabaritos.

## Decisões de regra

### 1. Prioridade entre os tipos

**Problema:** um par pode se encaixar em mais de um tipo. Dois monitorados da mesma facção também são dois monitorados, e um agressor pode ter a mesma facção da vítima. Só pode haver um registro por par em cada timestamp.

**Solução:** cascata na ordem `protetiva` → `faccao` → `generico`, em que o primeiro que casar vence. `protetiva` vem primeiro porque é o vínculo mais específico: a medida protetiva liga duas pessoas determinadas. `faccao` vem antes de `generico` porque também é mais específica.

**Base:** os gabaritos confirmam que um par da mesma facção gera só `faccao`. A prioridade de `protetiva` sobre `faccao` não aparece nos dados, porque nenhuma vítima tem facção. Esse caso é coberto só por teste unitário.

### 2. Vítima perto de quem não é seu agressor

**Problema:** o enunciado separa monitorados de vítimas ao definir os tipos, mas também define `idMonitorado` como "usuário de tornozeleira ou vítima". Assim, `generico` poderia incluir a vítima, e os gabaritos não cobrem esse caso.

**Solução:** não registrar. Um falso positivo tira 1 ponto, e um encontro omitido não tira nenhum, então registrar só compensaria se essa leitura fosse a mais provável. Como a leitura contrária é possível, a regra é configurável com `--incluir-vitima-em-generico`. Pela cascata, uma vítima com a mesma facção de quem não é seu agressor ainda resulta em `faccao`.

**Base:** a decisão é uma inferência, não uma confirmação. Os 7 JSONs saem idênticos com a opção e sem ela, então a escolha não muda o resultado nestes datasets.

## Problemas encontrados e soluções

### 1. Arquivo maior que o limite de string do Node

**Problema:** o dataset 7 tem 608 MB e passa do limite de string do Node (cerca de 512 MB), então não pode ser lido de uma vez como texto.

**Solução:** leitura em blocos de 1 MB, cortando cada bloco na última quebra de linha. A linha incompleta fica guardada até o bloco seguinte.

**Base:** a leitura do arquivo inteiro falhava com erro nesse dataset. Um teste confere o resultado com linhas cortadas entre blocos de vários tamanhos.

### 2. Campo vazio virando coordenada real

**Problema:** `Number("")` vale 0, então uma latitude vazia viraria uma coordenada válida e poderia gerar um encontro falso. Por outro lado, interromper o processamento por causa de uma linha ruim perderia o dataset inteiro.

**Solução:** validação estrita de ID, coordenadas e `medidaProtetiva`. A linha inválida é descartada e contada, e o processamento continua.

### 3. Agressor que aparece depois da vítima

**Problema:** a lista de agressores está na linha da vítima, e o enunciado não garante a ordem das linhas. Classificar durante a leitura poderia errar o tipo do encontro.

**Solução:** o vínculo é montado nos dois sentidos depois da leitura, e a classificação fica para o fim.

### 4. Última casa decimal de `distanciaMetros`

**Problema:** reorganizar a fórmula, mesmo sem mudar a matemática, altera a última casa decimal em alguns casos.

**Solução:** `asin` com a conversão `x * PI / 180`. Os testes comparam a distância com igualdade exata, porque uma tolerância esconderia essa diferença.

### 5. Gabaritos não definem a forma exata do Haversine

**Problema:** duas formas de agrupar a multiplicação acertam os 10 valores dos gabaritos, mas diferem em 1,8e-15 m em 5 registros dos datasets 4 a 7.

**Solução:** mantive a forma que segue a fórmula com `sin²`. Essa diferença só afeta a nota se a distância for comparada sem tolerância.

### 6. Criação de strings dominando o tempo

**Problema:** criar strings e converter números em cada linha dominava o tempo nos arquivos grandes, com até 12 milhões de linhas.

**Solução:** as linhas comuns são lidas direto dos bytes, e a coordenada vira inteiro ÷ potência de 10. O cabeçalho, a primeira linha de cada ID e os formatos incomuns continuam na validação completa.

### 7. Excesso de pares comparados

**Problema:** comparar todos os pares chega a 714 milhões de comparações no dataset 7, embora quase todos estejam longe demais.

**Solução:** o grupo é ordenado por latitude, reaproveitando a ordem do timestamp anterior, e a busca de cada pessoa para no primeiro vizinho a mais de 0,00018°. Retirar essa mudança multiplica a soma dos tempos por 2,6. O limite é seguro porque a distância real nunca é menor que `R·|Δφ|`, e 20 m equivalem a cerca de 0,00017986°. Uma força bruta sem o filtro encontrou os mesmos pares, e as pessoas se movem pouco em 5 s, o que deixa a ordem anterior quase certa.

### 8. Arquivo inteiro guardado na memória

**Problema:** guardar todas as posições até o fim da leitura levava o pico de memória a 687 MB no dataset 7 e aumentava o custo de coleta de lixo.

**Solução:** cada grupo é comparado assim que o timestamp muda, e os pares próximos ficam guardados para classificar no fim. A distância não depende do cadastro de pessoas, então só a classificação precisa esperar.

### 9. Resultado dependente da ordem do arquivo

**Problema:** comparar grupo a grupo só é correto se as linhas de cada timestamp estiverem juntas. Em um arquivo fora de ordem, pares seriam perdidos.

**Solução:** um timestamp menor que o anterior interrompe a leitura, que recomeça guardando todos os grupos. O resultado é o mesmo, com custo maior só nesse caso.

## Limitações

- Vítima com vários agressores, vítima com facção e distância exata de 20 m não ocorrem nos dados: são cobertos só por testes sintéticos.
- Se o avaliador contar um encontro por episódio, os 3 registros de timestamps seguidos (2 no dataset 3 e 1 no dataset 7) contam como falsos positivos. O enunciado indica o contrário.

## Uso de IA

Desenvolvi esta solução com a ajuda do **Claude (Anthropic)**, pelo Claude Code. A IA fez as medições de desempenho e a auditoria e propôs as otimizações. Eu conduzi o trabalho: defini a arquitetura, as regras e os critérios, revisei as decisões e sou responsável pela solução. O critério foi não aceitar nada sem evidência, e não complicar demais a solução.
