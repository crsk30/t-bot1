/**
 * NSE Algo Trading — Ollama AI Service
 * =====================================
 * Connects to local Ollama (http://localhost:11434) to run LLM analysis
 * on stock technicals, signals and market data.
 */

const axios = require("axios");

const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

/**
 * Build a structured prompt for stock analysis.
 */
function buildAnalysisPrompt(symbol, quote, indicators, signals) {
  const signalSummary =
    signals && signals.length
      ? signals
          .map(
            (s) =>
              `- ${s.strategy}: ${s.action} (confidence: ${s.confidence || "N/A"})`
          )
          .join("\n")
      : "No active signals";

  return `You are an expert NSE Indian stock market analyst with deep knowledge of technical analysis and swing trading.

Analyze the stock below and return ONLY a valid JSON object — no prose, no markdown, no explanation outside the JSON.

## Stock: ${symbol}

### Current Quote
- Price: ₹${quote?.currentPrice || quote?.price || "N/A"}
- Day Change: ${quote?.change || "N/A"} (${quote?.changePercent || "N/A"}%)
- Volume: ${quote?.volume || "N/A"}
- 52W High: ₹${quote?.fiftyTwoWeekHigh || "N/A"}
- 52W Low: ₹${quote?.fiftyTwoWeekLow || "N/A"}

### Technical Indicators
- RSI(14): ${indicators?.rsi || "N/A"}
- MACD Line: ${indicators?.macd || "N/A"}
- MACD Signal: ${indicators?.macd_signal || "N/A"}
- EMA 20: ₹${indicators?.ema20 || "N/A"}
- EMA 50: ₹${indicators?.ema50 || "N/A"}
- EMA 200: ₹${indicators?.ema200 || "N/A"}
- Bollinger Upper: ₹${indicators?.bb_upper || "N/A"}
- Bollinger Lower: ₹${indicators?.bb_lower || "N/A"}
- ATR: ${indicators?.atr || "N/A"}
- ADX: ${indicators?.adx || "N/A"}

### Strategy Signals
${signalSummary}

Return ONLY this exact JSON structure (fill in all values):
{
  "summary": "2-3 sentence executive summary of the stock's current state",
  "trend": "BULLISH|BEARISH|NEUTRAL",
  "trend_strength": <integer 1-10>,
  "technical_analysis": "Detailed technical analysis paragraph",
  "key_levels": {
    "support": [<price1>, <price2>],
    "resistance": [<price1>, <price2>]
  },
  "trade_recommendation": {
    "action": "BUY|SELL|HOLD",
    "entry_price": <number>,
    "target_price": <number>,
    "stop_loss": <number>,
    "risk_reward_ratio": <number>,
    "position_size_advice": "small|medium|large"
  },
  "risk_assessment": "LOW|MEDIUM|HIGH",
  "risk_factors": ["factor1", "factor2"],
  "sentiment": "POSITIVE|NEGATIVE|NEUTRAL",
  "time_horizon": "SHORT_TERM|MEDIUM_TERM|LONG_TERM",
  "confidence_score": <integer 1-100>,
  "reasoning": "Detailed reasoning for the recommendation"
}`;
}

/**
 * Run a stock analysis through Ollama and return structured JSON.
 */
async function analyzeStock(symbol, quote, indicators, signals) {
  const prompt = buildAnalysisPrompt(symbol, quote, indicators, signals);

  try {
    const response = await axios.post(
      `${OLLAMA_BASE}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.3,
          top_p: 0.85,
          num_predict: 1024,
        },
      },
      { timeout: 120000 }
    );

    const rawText = response.data?.response || "";
    // Extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Ollama returned no valid JSON");
    }
    const analysis = JSON.parse(jsonMatch[0]);
    return {
      symbol,
      model: OLLAMA_MODEL,
      generated_at: new Date().toISOString(),
      ...analysis,
    };
  } catch (err) {
    throw new Error(`Ollama analysis failed: ${err.message}`);
  }
}

/**
 * Stream a stock analysis through Ollama (calls callback with each chunk).
 */
async function analyzeStockStream(symbol, quote, indicators, signals, onChunk) {
  const prompt = buildAnalysisPrompt(symbol, quote, indicators, signals);

  const response = await axios.post(
    `${OLLAMA_BASE}/api/generate`,
    {
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
      options: { temperature: 0.3, top_p: 0.85, num_predict: 1500 },
    },
    { responseType: "stream", timeout: 180000 }
  );

  let fullText = "";
  return new Promise((resolve, reject) => {
    response.data.on("data", (chunk) => {
      try {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            fullText += parsed.response;
            onChunk(parsed.response);
          }
        }
      } catch (_) {}
    });
    response.data.on("end", () => resolve(fullText));
    response.data.on("error", reject);
  });
}

/**
 * Get Ollama server status and available models.
 */
async function getOllamaStatus() {
  try {
    const [tagsRes] = await Promise.all([
      axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 }),
    ]);
    return {
      online: true,
      base_url: OLLAMA_BASE,
      active_model: OLLAMA_MODEL,
      available_models: tagsRes.data?.models?.map((m) => m.name) || [],
    };
  } catch {
    return { online: false, base_url: OLLAMA_BASE, active_model: OLLAMA_MODEL };
  }
}

/**
 * Analyze a batch of news headlines for sentiment.
 */
async function analyzeSentiment(symbol, headlines) {
  const prompt = `You are a financial sentiment analyst. Analyze these news headlines for ${symbol} stock on NSE India.

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Return ONLY valid JSON:
{
  "overall_sentiment": "POSITIVE|NEGATIVE|NEUTRAL",
  "sentiment_score": <integer -100 to 100>,
  "key_themes": ["theme1","theme2"],
  "impact_assessment": "brief impact statement",
  "headline_sentiments": [
    {"headline": "...", "sentiment": "POSITIVE|NEGATIVE|NEUTRAL", "score": <-100 to 100>}
  ]
}`;

  const response = await axios.post(
    `${OLLAMA_BASE}/api/generate`,
    { model: OLLAMA_MODEL, prompt, stream: false, format: "json", options: { temperature: 0.2 } },
    { timeout: 60000 }
  );

  const rawText = response.data?.response || "";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in sentiment response");
  return JSON.parse(jsonMatch[0]);
}

module.exports = { analyzeStock, analyzeStockStream, getOllamaStatus, analyzeSentiment, OLLAMA_MODEL, OLLAMA_BASE };
