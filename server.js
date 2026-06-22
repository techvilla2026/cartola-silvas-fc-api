const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "online",
    versao: "4.0",
    app: "Cartola Silvas FC",
    mensagem: "Servidor funcionando com sucesso",
    ultimaAtualizacao: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
