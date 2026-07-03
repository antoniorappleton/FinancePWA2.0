function MORNINGSTAR_PRICE() {
  var url = "https://global.morningstar.com/en-nd/investments/etfs/0P0000MEHR/quote?investments=fi";

  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  var code = response.getResponseCode();
  var html = response.getContentText();

  if (code !== 200) {
    return "HTTP " + code;
  }

  // tenta apanhar um preço em JSON embebido
  var patterns = [
    /"lastPrice"\s*:\s*"?([0-9.,]+)"?/i,
    /"price"\s*:\s*"?([0-9.,]+)"?/i,
    /"nav"\s*:\s*"?([0-9.,]+)"?/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1];
  }

  return "Preço não encontrado";
}