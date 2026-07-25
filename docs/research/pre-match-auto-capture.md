# Pre-Match Auto Capture

Comando:

```bash
npm run research:auto-capture-pre-match
```

Dry-run:

```bash
npm run research:auto-capture-pre-match -- --dry-run
```

O script consulta `/mercado/status`, identifica rodada e deadline, calcula a janela de captura e so grava snapshot quando a captura e temporalmente segura.

## Janelas

- `PRIMARY`: 360 a 120 minutos antes do deadline.
- `FINAL`: 90 a 30 minutos antes do deadline.

Nao ha captura fora da janela nem depois do deadline.

## Idempotencia

Se ja existir `PRIMARY`, outra captura `PRIMARY` nao e criada.
Se ja existir `FINAL`, outra captura `FINAL` nao e criada.
`FINAL` e preservada como snapshot distinto de `PRIMARY`.

## Escolha Para Avaliacao

Para avaliar uma rodada, usar `FINAL` valido quando existir; caso contrario usar `PRIMARY` valido. A escolha e feita antes do outcome e nao depende do resultado posterior.

## Agendamento

Opcoes:

- GitHub Actions scheduled workflow: `RECOMMENDED`, requer setup externo de workflow/commit pelo operador.
- Execucao manual: `AVAILABLE`, boa como fallback imediato.
- Cron no host atual: `NOT_RELIABLE` se o ambiente dormir.
- Cron HTTP externo: `REQUIRES_EXTERNAL_SETUP`.
- Render interno: `REQUIRES_EXTERNAL_SETUP`, depende do plano e configuracao.
