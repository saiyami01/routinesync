const express = require('express');
const cors = require('cors');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');

// Simple File-Based Database for shared access
const DB_FILE = path.join(__dirname, 'data.json');
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([
    { id: '1', title: 'Welcome Routine', content: 'Created by Claude via MCP!', createdAt: new Date().toISOString() }
  ]));
}

function getItems() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { return []; }
}
function saveItems(items) {
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));
}

// Check if running as MCP stdio child process
if (process.argv.includes('--mcp')) {
  const server = new Server({ name: 'routinesync', version: '1.0.0' }, { capabilities: { tools: {} } });
  
  // 1. Define the tool schema for Claude
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'save_workout_split',
      description: 'Saves a structured workout split with daily routines and exercises to the user dashboard.',
      inputSchema: {
        type: 'object',
        properties: {
          splitName: { type: 'string', description: 'Name of the workout split (e.g. 3-Day Push-Pull-Legs)' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dayName: { type: 'string', description: 'Day title (e.g. Day 1: Push Focus)' },
                exercises: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Exercise name' },
                      sets: { type: 'integer', description: 'Number of sets' },
                      reps: { type: 'string', description: 'Rep range (e.g. 8-12)' }
                    },
                    required: ['name', 'sets', 'reps']
                  }
                }
              },
              required: ['dayName', 'exercises']
            }
          }
        },
        required: ['splitName', 'days']
      }
    }]
  }));

  // 2. Handle the tool call when Claude sends the structured workout data
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'save_workout_split') {
      const { splitName, days } = request.params.arguments;
      const items = getItems();
      
      const newSplit = {
        id: String(Date.now()),
        splitName,
        days,
        createdAt: new Date().toISOString()
      };
      
      items.unshift(newSplit);
      saveItems(items);
      
      return { 
        content: [{ type: 'text', text: `Successfully saved workout split "${splitName}" with ${days.length} days to your dashboard!` }] 
      };
    }
    throw new Error('Tool not found');
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
} else {
  // Web Server Mode
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/items', (req, res) => res.json(getItems()));
  app.put('/api/items/:id', (req, res) => {
    const items = getItems();
    const item = items.find(i => i.id === req.params.id);
    if (item) {
      if (req.body.title !== undefined) item.title = req.body.title;
      if (req.body.content !== undefined) item.content = req.body.content;
      saveItems(items);
      return res.json({ success: true, item });
    }
    res.status(404).json({ error: 'Item not found' });
  });
// Add this route to your Express web server handlers in index.js:
  app.put('/api/items/exercise/:id', (req, res) => {
    const { dayIndex, exerciseIndex, newName } = req.body;
    const items = getItems();
    const item = items.find(i => i.id === req.params.id);
    
    if (item && item.days && item.days[dayIndex] && item.days[dayIndex].exercises[exerciseIndex]) {
      item.days[dayIndex].exercises[exerciseIndex].name = newName;
      saveItems(items);
      return res.json({ success: true, item });
    }
    res.status(404).json({ error: 'Workout or exercise not found' });
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}