const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "online",
    versao: "4.2",
    app: "Cartola Silvas FC",
    mensagem: "Servidor funcionando com notícias da rodada",
    ultimaAtualizacao: new Date().toISOString(),
    noticias: [
      {
        titulo: "Atacante Favorito pode ser poupado",
        clube: "Brasil",
        jogador: "Atacante Favorito",
        nivel: "alto",
        fonte: "Teste manual do servidor",
        resumo: "Jogador aparece como risco alto para testar a Central de Notícias."
      },
      {
        titulo: "Meia Bola Parada treinou parcialmente",
        clube: "Argentina",
        jogador: "Meia Bola Parada",
        nivel: "medio",
        fonte: "Teste manual do servidor",
        resumo: "Situação exige atenção antes de confirmar nos 25 times."
      },
      {
        titulo: "Centroavante Forte treinou normalmente",
        clube: "França",
        jogador: "Centroavante Forte",
        nivel: "baixo",
        fonte: "Teste manual do servidor",
        resumo: "Jogador aparece como opção segura para a rodada."
      }
    ]
  });
});

app.get("/teste-cartola", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://api.cartolafc.globo.com/mercado/status"
    );

    const dados = await resposta.json();

    res.json({
      sucesso: true,
      dados
    });
  } catch (erro) {
    res.json({
      sucesso: false,
      erro: erro.toString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
