const { CAPTURE_PHASE } = require("./constants");

function closingDateFromMarketStatus(marketStatus) {
  const closing = marketStatus?.fechamento;
  if (!closing) return null;

  if (Number.isFinite(Number(closing.timestamp))) {
    return new Date(Number(closing.timestamp) * 1000);
  }

  const { ano, mes, dia, hora, minuto } = closing;
  if ([ano, mes, dia, hora, minuto].every((value) => Number.isFinite(Number(value)))) {
    return new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto), 0));
  }

  return null;
}

function determineCapturePhase(capturedAt, marketClosingAt) {
  if (!capturedAt || !marketClosingAt) return CAPTURE_PHASE.UNKNOWN;
  const captured = new Date(capturedAt);
  const closing = new Date(marketClosingAt);

  if (Number.isNaN(captured.getTime()) || Number.isNaN(closing.getTime())) {
    return CAPTURE_PHASE.UNKNOWN;
  }

  return captured.getTime() < closing.getTime()
    ? CAPTURE_PHASE.PRE_MARKET_CLOSE
    : CAPTURE_PHASE.POST_MARKET_CLOSE;
}

function isValidPreRoundSnapshot({ capturePhase, marketClosingAt }) {
  return Boolean(marketClosingAt && capturePhase === CAPTURE_PHASE.PRE_MARKET_CLOSE);
}

module.exports = {
  closingDateFromMarketStatus,
  determineCapturePhase,
  isValidPreRoundSnapshot
};
