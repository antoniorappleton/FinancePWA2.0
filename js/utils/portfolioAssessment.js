export function calculatePortfolioAssessment({ health, riskDecomp } = {}) {
  const healthScore = Number(health?.score || 0);
  const resilienceScore = Number(riskDecomp?.resilienceScore || 0);
  const total = Math.round(healthScore * 0.6 + resilienceScore * 0.4);
  let label = "Crítico";
  if (total >= 80) label = "Excelente";
  else if (total >= 65) label = "Saudável";
  else if (total >= 50) label = "Razoável";
  else if (total >= 35) label = "Necessita Atenção";
  return {
    total: Math.max(0, Math.min(100, total)),
    label,
    breakdown: {
      saude: healthScore,
      resiliencia: resilienceScore
    }
  };
}