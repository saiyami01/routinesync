# RoutineSync - MCP Workout Dashboard

RoutineSync is a local-first workout dashboard driven by Claude via the Model Context Protocol (MCP). It allows users to manage and track structured workout routines without storing or managing any AI API keys within the application backend.

## Architecture & Features

* **Zero AI Keys in Code:** Claude operates as the external reasoning engine via MCP; the application handles persistence, state management, and UI rendering.
* **Human-in-the-Loop Editing:** Live UI allows users to check off exercises and rename workout movements directly on the dashboard.
* **Structured Workout Schema:** Supports multi-day splits with exercise names, sets, rep ranges, and tracking checkboxes.

## Tech Stack

* **Backend:** Node.js, Express
* **Frontend:** Tailwind CSS, Vanilla JavaScript
* **Protocol:** Model Context Protocol (MCP) SDK (stdio transport)
* **Storage:** Local JSON file persistence (`data.json`)

## Setup & Running Locally

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/saiyami01/routinesync.git](https://github.com/saiyami01/routinesync.git)
   cd routinesync
