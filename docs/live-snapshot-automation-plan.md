# Plano de Automacao de Snapshots

Build: 4.5.4 fecha GitHub Actions horario com commit controlado, persistencia oficial por Git e Render Auto-Deploy On Commit confirmado.

## Estrategia implementada

- Usar `npm run live:snapshot:auto -- --season=2026` como entrada unica para automacao.
- Capturar o primeiro snapshot valido pre-fechamento.
- Evitar duplicatas quando o fingerprint logico nao muda.
- Capturar mudancas significativas de atletas, partidas, previsoes, Time Ideal e fechamento.
- Aumentar a prioridade nas horas anteriores ao fechamento.
- Fazer uma captura final de seguranca nos ultimos 15 minutos, quando possivel.
- Nunca depender de um unico snapshot.
- Auditar hashes e manifests apos cada captura gravada.
- Ignorar automaticamente snapshots `POST_MARKET_CLOSE` ou `UNKNOWN` em avaliacao pre-rodada.

## Render

Preferir Render Cron Job ou scheduler separado chamando:

```bash
npm run live:snapshot:auto -- --season=2026 --strict
```

Nao foi criado endpoint publico de escrita nesta build.

Auditoria 4.5.2: Render filesystem local e tratado como inseguro para snapshots de producao sem Persistent Disk confirmado. Render Cron Jobs nao compartilham Persistent Disk. Portanto, `PRODUCTION_AUTOMATION_STATUS=BLOCKED` no estado atual conhecido.

## GitHub Actions

Um workflow agendado pode ser criado em build futura, mas a 4.5.1 nao adiciona workflow ativo para evitar commits/pushes automaticos sem decisao operacional explicita.

Na 4.5.4, GitHub Actions com commit dos snapshots esta ativo e confirmado externamente em `.github/workflows/live-snapshot-capture.yml`.

Estado:

```text
schedulerFrequency=HOURLY
workflowActivationStatus=ACTIVE
gitPersistenceMode=AUTOMATED_COMMIT_ACTIVE
productionAutomationStatus=READY
```

Limitacao: o scheduler horario nao garante capturas a cada 15 minutos na ultima hora; a politica interna continua recomendando essa janela, mas a infraestrutura preparada executa no maximo uma vez por hora.

## Concorrencia

Quando houver agendador externo, configure uma unica execucao por vez. A aplicacao tambem usa arquivos imutaveis e escrita atomica, mas a prevencao primaria de concorrencia fica no scheduler.
