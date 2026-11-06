const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Persistent data functions
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

// Web UI Dashboard APIs
app.get('/api/workouts', (req, res) => {
  res.json(readData());
});

app.post('/api/workouts', (req, res) => {
  const data = readData();
  data.splits.push(req.body);
  writeData(data);
  res.json({ success: true, data: req.body });
});

// Official MCP Server Initialization
const mcpServer = new Server(
  { name: "routinesync", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register MCP Tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_workout_split",
        description: "Save or update an AI-generated workout split routine to the RoutineSync dashboard.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Title of the workout split" },
            days: { type: "array", items: { type: "object" }, description: "Array of daily workout routines" }
          },
          required: ["title", "days"]
        }
      }
    ]
  };
});

// Handle MCP Tool Invocations
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "save_workout_split") {
    const { title, days } = request.params.arguments;
    const data = readData();
    const newSplit = {
      id: "split_" + Date.now(),
      title: title || "AI Workout Split",
      days: days || [],
      createdAt: new Date().toISOString()
    };
    data.splits.push(newSplit);
    writeData(data);

    return {
      content: [
        {
          type: "text",
          text: `Successfully synced split "${newSplit.title}" with ${newSplit.days.length} training days to RoutineSync!`
        }
      ]
    };
  }
  throw new Error(`Tool not found: ${request.params.name}`);
});

// Active SSE Connections Store
const transports = new Map();

// GET /sse endpoint for mcp-remote handshake
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

// POST /messages endpoint for handling incoming tool calls
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Session not found");
  }
});

app.listen(PORT, () => {
  console.log(`RoutineSync server running on port ${PORT}`);
});
