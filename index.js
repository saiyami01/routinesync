const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Persistent data helpers
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = { splits: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return { splits: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Web Dashboard API routes
app.get('/api/workouts', (req, res) => res.json(readData()));
app.post('/api/workouts', (req, res) => {
  const data = readData();
  data.splits.push(req.body);
  writeData(data);
  res.json({ success: true, data: req.body });
});

// Tool definition catalog
const TOOLS = [
  {
    name: "save_workout_split",
    description: "Save or update an AI-generated workout split routine to the RoutineSync dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the workout split" },
        days: { type: "array", items: { type: "object" }, description: "Array of training days" }
      },
      required: ["title", "days"]
    }
  }
];

// Execute tool call logic
function handleToolCall(name, args) {
  if (name === "save_workout_split") {
    const data = readData();
    const newSplit = {
      id: "split_" + Date.now(),
      title: args.title || "AI Workout Split",
      days: args.days || [],
      createdAt: new Date().toISOString()
    };
    data.splits.push(newSplit);
    writeData(data);

    return {
      content: [
        {
          type: "text",
          text: `Successfully saved split "${newSplit.title}" with ${newSplit.days.length} training days to RoutineSync!`
        }
      ]
    };
  }
  throw new Error(`Tool not found: ${name}`);
}

// --- SSE TRANSPORT LAYER WITH HEARTBEAT ---
const clients = new Map();

app.get('/sse', (req, res) => {
  const sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  clients.set(sessionId, res);

  // Send initial endpoint URI line expected by mcp-remote
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

  // Heartbeat ping every 15 seconds to keep mcp-remote alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(sessionId);
  });
});

app.post('/messages', (req, res) => {
  const sessionId = req.query.sessionId;
  const body = req.body;

  if (body.method === "tools/list") {
    const client = clients.get(sessionId);
    const response = {
      jsonrpc: "2.0",
      id: body.id,
      result: { tools: TOOLS }
    };
    if (client) client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return res.status(202).end();
  }

  if (body.method === "tools/call") {
    const client = clients.get(sessionId);
    const { name, arguments: args } = body.params || {};
    try {
      const result = handleToolCall(name, args);
      const response = {
        jsonrpc: "2.0",
        id: body.id,
        result
      };
      if (client) client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    } catch (err) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32603, message: err.message }
      };
      if (client) client.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
    }
    return res.status(202).end();
  }

  // General MCP handshake response
  if (body.method === "initialize") {
    const client = clients.get(sessionId);
    const response = {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "routinesync", version: "1.0.0" }
      }
    };
    if (client) client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return res.status(202).end();
  }

  res.status(200).end();
});

// Direct HTTP fallback routes
app.get('/api/mcp/tools', (req, res) => res.json({ tools: TOOLS }));
app.post('/api/mcp/tools', (req, res) => {
  const { name, arguments: args } = req.body;
  try {
    const result = handleToolCall(name, args);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: { message: err.message } });
  }
});

app.listen(PORT, () => {
  console.log(`RoutineSync server running on port ${PORT}`);
});
