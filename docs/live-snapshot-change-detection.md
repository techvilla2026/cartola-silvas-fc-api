# Deteccao de Mudancas em Snapshots

Build: 4.5.1

## Fingerprint logico

O fingerprint ignora campos volateis e considera apenas dados esportivos/operacionais relevantes.

Campos ignorados:

- `capturedAt`
- tempos de requisicao
- ids de execucao
- hash final
- metadados tecnicos volateis
- ordem nao significativa de objetos

## Mudancas relevantes

- atleta entrou ou saiu do mercado;
- `statusId` alterado;
- preco alterado;
- media alterada;
- jogos alterados;
- clube ou posicao alterados;
- partida alterada;
- mando alterado;
- data ou local alterados;
- fechamento alterado;
- Time Ideal alterado;
- capitao alterado;
- vice alterado;
- previsao mudou acima da tolerancia;
- categoria da Central alterada.

## Tolerancia

```text
predictionMeaningfulDelta = 0.1
```

Diferencas menores que 0.1 ponto na previsao nao obrigam novo snapshot se nenhuma outra mudanca relevante existir.

## Historico

Quando uma captura e gravada apos um snapshot anterior, o arquivo `change-history.json` registra apenas o resumo da mudanca, sem duplicar o snapshot inteiro.
