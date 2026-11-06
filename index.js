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
app.use(express.static(path.join(__dirname, 'public'))); // Serves your dashboard frontend

// Helper to read/write persistent data
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

// --- DASHBOARD API ENDPOINTS ---
app.get('/api/workouts', (req, res) => {
  const data = readData();
  res.json(data);
});

app.post('/api/workouts', (req, res) => {
  const data = readData();
  const newSplit = req.body;
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

// --- MCP TOOL ENDPOINTS (Fixed for mcp-remote) ---
// Handles tool discovery via GET
app.get('/api/mcp/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: "save_workout_split",
        description: "Save or update an AI-generated workout split routine to the user dashboard.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Name of the workout split (e.g., 4-Day Upper/Lower Split)" },
            days: {
              type: "array",
              description: "Array of workout days containing exercises, sets, and reps.",
              items: { type: "object" }
            }
          },
          required: ["title", "days"]
        }
      }
    ]
  });
});

// Handles tool execution via POST from Claude / mcp-remote
app.post('/api/mcp/tools', (req, res) => {
  try {
    const { name, arguments: args } = req.body;
    
    if (name === 'save_workout_split') {
      const data = readData();
      const newSplit = {
        id: 'split_' + Date.now(),
        title: args.title || 'AI Generated Split',
        days: args.days || [],
        createdAt: new Date().toISOString()
      };
      
      data.splits.push(newSplit);
      writeData(data);

      return res.json({
        content: [
          {
            type: "text",
            text: `Successfully saved workout split "${newSplit.title}" with ${newSplit.days.length} training days to your RoutineSync dashboard!`
          }
        ]
      });
    }

    res.status(400).json({ error: { message: `Unknown tool: ${name}` } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// Optional SSE endpoint fallback for standard MCP remote transport
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', endpoint: '/api/mcp/tools' })}\n\n`);
  
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`RoutineSync server running on port ${PORT}`);
});
