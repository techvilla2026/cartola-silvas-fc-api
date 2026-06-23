app.get("/teste-cartola", async (req, res) => {
  const resultados = {};

  try {
    const mercado = await fetch(
      "https://api.cartolafc.globo.com/mercado/status"
    );

    resultados.mercado = mercado.status;
  } catch (e) {
    resultados.mercado = e.toString();
  }

  try {
    const clubes = await fetch(
      "https://api.cartolafc.globo.com/clubes"
    );

    resultados.clubes = clubes.status;
  } catch (e) {
    resultados.clubes = e.toString();
  }

  try {
    const rodadas = await fetch(
      "https://api.cartolafc.globo.com/rodadas"
    );

    resultados.rodadas = rodadas.status;
  } catch (e) {
    resultados.rodadas = e.toString();
  }

  res.json(resultados);
});
