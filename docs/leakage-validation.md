# Validacao de vazamento

Build: 4.2.1.

Comando executado:

```bash
npm run historical:check-leakage -- --season=2026 --from=1 --to=18
```

Resultado:

- PASS: 18.
- WARNING: 0.
- FAIL: 0.

## O que e verificado

- Placar em `pre-round`.
- Pontos da propria rodada no jogador.
- Scouts da propria rodada no jogador.
- Variacao de preco da propria rodada como feature direta.
- Media ou jogos com provenance apontando para a propria rodada.
- Schema pre-rodada inesperado.

## Observacao

O verificador nao prova que toda semantica historica esta perfeita. Ele garante que os vazamentos estruturais conhecidos nao aparecem no `pre-round.json` v2.
