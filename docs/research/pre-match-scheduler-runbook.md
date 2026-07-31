# Runbook - Safe Prospective Pre-Match Scheduler

Diretorio oficial no Windows:

```powershell
Set-Location 'C:\SLVS Intelligence\Meu Time Ideal\cartola-silvas-fc-api'
```

## 1. Execucao manual segura

```powershell
npm run research:auto-capture-pre-match -- --dry-run
npm run research:auto-capture-pre-match -- --dry-run --json
```

Nunca remova `--dry-run` sem confirmar persistencia, janela e aprovacao operacional.

## 2. Workflow dispatch

Abra Actions, selecione **Research Pre-Match Auto Capture**, escolha **Run workflow** e mantenha as Repository Variables falsas. O resultado aparece no GitHub Actions Summary.

## 3. Variaveis

- `PRE_MATCH_CAPTURE_WRITE_ENABLED=false`: dry-run obrigatorio;
- `PRE_MATCH_CAPTURE_COMMIT_ENABLED=false`: nenhum commit ou push.

Uma captura real somente e permitida quando ambas forem exatamente `true`. Configure-as em Settings > Secrets and variables > Actions > Variables. Nao use segredo para valores booleanos.

## 4. Allowlist e commit restrito

```powershell
npm run research:pre-match:persistence -- --json
```

Confirme que `unexpectedFiles` esta vazio e que apenas os dois caminhos documentados aparecem. O workflow usa staging explicito e bot `slvs-research-capture-bot`. Antes de habilitar commit, confirme que `[skip render]` impede deploy no provedor atual e execute um dispatch controlado fora da janela.

## 5. Readiness e status

```powershell
Invoke-RestMethod 'http://localhost:3000/research/pre-match-availability/scheduler-readiness'
Invoke-RestMethod 'http://localhost:3000/research/pre-match-availability/capture-status'
```

O status padrao consulta a API atual. Para uma rodada anterior:

```powershell
Invoke-RestMethod 'http://localhost:3000/research/pre-match-availability/capture-status?round=20'
```

## 6. CAPTURE_AT_RISK

Mantenha reconstrucao retrospectiva proibida. Verifique API, deadline, variaveis, logs, allowlist e persistencia. Se tudo estiver aprovado, execute um dispatch supervisionado dentro da janela.

## 7. MISSED_CAPTURE

Registre `MISSED_PROSPECTIVE_CAPTURE`, preserve os logs e investigue scheduler/persistencia. Nao altere timestamp, deadline ou live snapshots para fabricar uma captura prospectiva.

## 8. Desativacao rapida

Defina ambas as variaveis como `false`. Para interromper recorrencia, desabilite o workflow no GitHub Actions; nao apague snapshots nem modifique o workflow antigo.

## 9. Avaliacao posterior

Somente apos existir `post.players[].played` completo:

```powershell
npm run research:evaluate-pre-match -- --round=22
```

Nunca derive `played` de pontos ou scouts.
