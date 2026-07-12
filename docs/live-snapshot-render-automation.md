# Automacao no Render e Alternativas

Build: 4.5.1

## Opcao A - Render Cron Job

Executa:

```bash
npm run live:snapshot:auto -- --season=2026 --strict
```

Vantagens: roda perto do backend e usa ambiente Render.

Limitacoes: frequencia minima e disponibilidade dependem do plano Render. A documentacao oficial do Render indica que Cron Jobs nao acessam Persistent Disk; portanto essa opcao nao e suficiente se depender de arquivo local persistente compartilhado com o Web Service.

## Opcao B - GitHub Actions agendado

Pode executar o script em agenda, auditar e abrir commit automatizado somente se for explicitamente habilitado no futuro.

Nao foi criado workflow ativo nesta build.

Na auditoria 4.5.2, esta e a candidata mais plausivel sem contratar servico pago adicional, porque os snapshots versionados no Git sobrevivem a restart/redeploy. Ainda exige revisao manual de permissoes, concurrency, arquivos permitidos e politica de push.

## Opcao C - Servico externo de chamada

Pode chamar um job interno protegido ou disparar execucao manual em ambiente controlado.

Nesta build nao foi criado endpoint publico de escrita.

## Opcao D - Execucao manual de emergencia

```bash
npm run live:snapshot:auto -- --season=2026
```

## Seguranca

- nao usar endpoint `GET` para escrita;
- nao expor token;
- nao armazenar credenciais reais no repositorio;
- impedir execucoes simultaneas na camada externa quando houver agendador.

## Status 4.5.2

`PRODUCTION_AUTOMATION_STATUS=BLOCKED`

Motivo: nao ha storage persistente e scheduler ativo confirmados neste repositorio.
