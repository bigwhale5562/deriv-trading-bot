const WebSocket = require('ws');

// ——— CONFIGURATION ———
// Replace 'YOUR_API_TOKEN' with your actual Deriv API token (get from https://app.deriv.com/account/api)
const API_TOKEN = 'YOUR_API_TOKEN';

// Trading settings
const SYMBOL = 'R_75';                    // Asset: R_75 (popular synthetic index)
const CANDLE_GRANULARITY = 60;            // 1-minute candles
const STAKE = 0.35;                       // Stake amount (in USD or account currency)
const CONTRACT_DURATION = 5;              // 5-tick contracts
const FAST_EMA_PERIOD = 9;                // Fast EMA window
const SLOW_EMA_PERIOD = 21;               // Slow EMA window
const RSI_PERIOD = 14;                    // RSI period

// Internal storage
let candles = [];

// Connect to Deriv WebSocket API
const connection = new WebSocket('wss://ws.deriv.com/websockets/v3');

// On connection open
connection.onopen = () => {
    console.log('🔗 Connected to Deriv API');
    authorize();
};

// Send authorization request
function authorize() {
    connection.send(JSON.stringify({
        authorize: API_TOKEN
    }));
}

// Request candle history
function requestCandles() {
    connection.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjustment: 'raw',
        style: 'candles',
        granularity: CANDLE_GRANULARITY,
        count: 50,
        end: 'latest',
        req_id: 1
    }));
}

// Calculate EMA (Exponential Moving Average)
function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(prices, period) {
    if (prices.length <= period) return 50; // Default if not enough data

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length - 1; i++) {
        const diff = prices[i + 1] - prices[i];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Place a CALL or PUT trade
function buyContract(contractType) {
    connection.send(JSON.stringify({
        buy: 1,
        subscribe: 1,
        parameters: {
            contract_type: contractType,
            amount: STAKE,
            basis: 'stake',
            duration: CONTRACT_DURATION,
            duration_unit: 't',
            symbol: SYMBOL,
            currency: 'USD'
        },
        req_id: 2
    }));
    console.log(`📤 Placed ${contractType} trade: $${STAKE}`);
}

// Analyze candles and trade
function analyzeAndTrade(candleData) {
    const prices = candleData.map(candle => parseFloat(candle.close));
    if (prices.length < SLOW_EMA_PERIOD + RSI_PERIOD) return;

    const emaFast = calculateEMA(prices.slice(-FAST_EMA_PERIOD), FAST_EMA_PERIOD);
    const emaSlow = calculateEMA(prices.slice(-SLOW_EMA_PERIOD), SLOW_EMA_PERIOD);
    const rsi = calculateRSI(prices, RSI_PERIOD);
    const currentPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 2];

    // Log current state
    console.log(`📊 Price: ${currentPrice.toFixed(5)} | EMA Fast: ${emaFast.toFixed(5)} | EMA Slow: ${emaSlow.toFixed(5)} | RSI: ${rsi.toFixed(2)}`);

    // EMA Crossover Logic
    const isBullishCross = previousPrice <= emaSlow && currentPrice > emaFast && emaFast > emaSlow;
    const isBearishCross = previousPrice >= emaSlow && currentPrice < emaFast && emaFast < emaSlow;

    // Trade Signals with RSI Filter
    if (isBullishCross && rsi < 70) {
        buyContract('CALL');
    } else if (isBearishCross && rsi > 30) {
        buyContract('PUT');
    }
}

// WebSocket message handler
connection.onmessage = (event) => {
    const response = JSON.parse(event.data);

    if (response.error) {
        console.error('🔴 Error:', response.error.message);
        return;
    }

    // On successful authorization
    if (response.msg_type === 'authorize') {
        console.log('✅ Authorized successfully');
        requestCandles();
        // Refresh candles every 30 seconds
        setInterval(requestCandles, 30000);
    }

    // Receive candle history
    if (response.msg_type === 'historical' && response.req_id === 1) {
        if (response.candles && response.candles.length > 10) {
            analyzeAndTrade(response.candles);
        }
    }

    // Trade confirmation
    if (response.msg_type === 'buy') {
        console.log(`💸 Trade placed. Contract ID: ${response.buy.contract_id}`);
    }

    // Result of contract
    if (response.msg_type === 'proposal_open_contract') {
        const contract = response.proposal_open_contract;
        if (contract.status === 'won') {
            console.log(`🎉 Trade WON! Payout: $${contract.payout}`);
        } else if (contract.status === 'lost') {
            console.log(`💥 Trade LOST.`);
        }
    }
};

// Handle connection errors
connection.onerror = (error) => {
    console.error('🔴 Connection error:', error.message);
};

// Handle disconnection
connection.onclose = () => {
    console.log('🔌 Connection closed. Reconnecting in 5s...');
    setTimeout(() => {
        new WebSocket('wss://ws.deriv.com/websockets/v3');
    }, 5000);
};
