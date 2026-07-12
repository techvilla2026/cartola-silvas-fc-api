# Plano Futuro de Automacao de Snapshots

Build: 4.5.0 nao cria cron nem agendamento automatico.

## Estrategia recomendada

- Capturar diariamente enquanto o mercado estiver aberto.
- Aumentar a frequencia nas horas anteriores ao fechamento.
- Fazer uma captura final de seguranca antes do fechamento.
- Nunca depender de um unico snapshot.
- Auditar hashes e manifests apos cada janela de captura.
- Ignorar automaticamente snapshots `POST_MARKET_CLOSE` ou `UNKNOWN` em avaliacao pre-rodada.

## Render

Para automacao futura, preferir job externo ou scheduler separado chamando o script/servico com ambiente controlado. Nao expor endpoint publico de escrita.
