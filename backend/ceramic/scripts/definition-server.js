const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.DEFINITION_PORT || 7008;
const GENERATED_DIR = process.env.GENERATED_DIR || '/app/generated';

// Parse allowed origins from environment
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

// CORS configuration
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Cache the definition in memory after first read
let cachedDefinition = null;
let cacheTime = null;
const CACHE_TTL = 60000; // 1 minute cache

function getDefinition() {
  const now = Date.now();

  // Return cached if valid
  if (cachedDefinition && cacheTime && (now - cacheTime) < CACHE_TTL) {
    return cachedDefinition;
  }

  const defPath = path.join(GENERATED_DIR, 'definition.json');

  if (!fs.existsSync(defPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(defPath, 'utf-8');
    cachedDefinition = JSON.parse(content);
    cacheTime = now;
    console.log(`[${new Date().toISOString()}] Definition cached from ${defPath}`);
    return cachedDefinition;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error reading definition:`, err.message);
    return null;
  }
}

// Main endpoint - serve the runtime definition
app.get('/api/definition', (req, res) => {
  const definition = getDefinition();

  if (definition) {
    console.log(`[${new Date().toISOString()}] Served definition to ${req.ip}`);
    res.json(definition);
  } else {
    console.log(`[${new Date().toISOString()}] Definition not yet available`);
    res.status(503).json({
      error: 'Definition not yet generated',
      message: 'The ComposeDB composite is still being deployed. Please retry in a few moments.'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const definition = getDefinition();
  res.json({
    status: 'ok',
    definitionAvailable: !!definition,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Definition server running on port ${PORT}`);
  console.log(`  CORS origins: ${allowedOrigins.join(', ')}`);
  console.log(`  Generated dir: ${GENERATED_DIR}`);
});
