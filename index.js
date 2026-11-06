const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serves static UI dashboard files

// Helper functions for persistent data storage
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = { splits: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    return { splits: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- WEB DASHBOARD FRONTEND APIS ---
app.get('/api/workouts', (req, res) => {
  res.json(readData());
});

app.post('/api/workouts', (req, res) => {
  const data = readData();
  const newSplit = {
    id: "split_" + Date.now(),
    title: req.body.title || "New Workout Split",
    days: req.body.days || [],
    createdAt: new Date().toISOString()
  };
  data.splits.push(newSplit);
  writeData(data);
  res.json({ success: true, data: newSplit });
});

app.put('/api/workouts/:id', (req, res) => {
  const data = readData();
  const splitId = req.params.id;
  const updatedSplit = req.body;
  
  data.splits = data.splits.map(s => s.id === splitId ? updatedSplit : s);
  writeData(data);
  res.json({ success: true, data: updatedSplit });
});

app.delete('/api/workouts/:id', (req, res) => {
  const data = readData();
  const splitId = req.params.id;
  data.splits = data.splits.filter(s => s.id !== splitId);
  writeData(data);
  res.json({ success: true, message: "Split deleted" });
});

// --- MCP TOOL DEFINITIONS & LOGIC ---
const TOOLS = [
  {
    name: "save_workout_split",
    description: "Save or update an AI-generated workout split routine to the RoutineSync dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the workout split (e.g. 4-Day Upper/Lower Split)" },
        days: {
          type: "array",
          description: "Array of workout days containing exercises, sets, reps, and muscle groups.",
          items: { type: "object" }
        }
      },
      required: ["title", "days"]
    }
  }
];

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
          text: `Successfully synced split "${newSplit.title}" with ${newSplit.days.length} training days to RoutineSync dashboard!`
        }
      ]
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

// --- SSE TRANSPORT LAYER (mcp-remote setup) ---
const clients = new Map();

app.get('/sse', (req, res) => {
  const sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  clients.set(sessionId, res);

  // Send SSE endpoint URL back to client
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

  // Periodic heartbeat to prevent Render & mcp-remote timeouts
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
  const client = clients.get(sessionId);

  if (!client) {
    return res.status(400).send("Session not found");
  }

  // Handle initialization handshake
  if (body.method === "initialize") {
    const response = {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "routinesync", version: "1.0.0" }
      }
    };
    client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return res.status(202).end();
  }

  // Handle tool discovery requests
  if (body.method === "tools/list") {
    const response = {
      jsonrpc: "2.0",
      id: body.id,
      result: { tools: TOOLS }
    };
    client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return res.status(202).end();
  }

  // Handle tool execution requests from Claude
  if (body.method === "tools/call") {
    const { name, arguments: args } = body.params || {};
    try {
      const result = handleToolCall(name, args);
      const response = {
        jsonrpc: "2.0",
        id: body.id,
        result
      };
      client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    } catch (err) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32603, message: err.message }
      };
      client.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
    }
    return res.status(202).end();
  }

  res.status(200).end();
});

// Direct HTTP fallback routes for testing
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

// Start Express server
app.listen(PORT, () => {
  console.log(`RoutineSync server running on port ${PORT}`);
});
