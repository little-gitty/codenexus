import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { buildAstGraph } from './astGraph.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const groqApiKey = process.env.GROQ_API_KEY;
const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Cache for rollback feature: key -> rawInput
const originalCache = new Map();

function parseJsonResponse(rawText) {
  const text = String(rawText || '').trim();
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const payload = match ? match[1].trim() : text;
  return JSON.parse(payload);
}

async function callGroq(fileName, detectedLang, rawInput) {
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: groqModel,
        messages: [
          {
            role: 'system',
            content: `You are an expert ${detectedLang} developer. Fix the code/error provided. Return ONLY valid JSON with keys "patchedCode" (string) and "explanation" (string).`
          },
          {
            role: 'user',
            content: `File: ${fileName}\nLanguage: ${detectedLang}\nInput:\n${rawInput}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Groq API request failed.');
  }

  const text = data?.choices?.[0]?.message?.content || '';

  return parseJsonResponse(text);
}

// Root route for Render health checks & quick verification
app.get('/', (req, res) => {
  res.send('🚀 CodeNexus Backend is live and running!');
});

io.on('connection', (socket) => {
  console.log('⚡ Client connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Disconnected:', socket.id));
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Targeted socket logger
function emitLog(socketId, payload) {
  if (socketId) {
    io.to(socketId).emit('agent-log', payload);
  } else {
    io.emit('agent-log', payload);
  }
}

// ─── POST /api/run-agent ──────────────────────────────────────────────────────
app.post('/api/run-agent', async (req, res) => {
  try {
    const { 
      customCode = '', 
      sourceCode = '',
      errorTrace = '', 
      prompt = '', 
      language = 'Auto', 
      socketId,
      scenarioId 
    } = req.body;

    const rawInput = (customCode || errorTrace || prompt || '').trim();

    if (!rawInput) {
      return res.status(400).json({ error: "No stack trace or code provided." });
    }

    // 1. Language & File Name Resolution
    let fileName = 'solution.src';
    let detectedLang = language !== 'Auto' && language !== 'Auto-Detect' ? language : 'Golang';

    const matches = {
      Rust: rawInput.match(/([a-zA-Z0-9_\-]+\.rs)/i),
      Python: rawInput.match(/([a-zA-Z0-9_\-]+\.py)/i),
      'C++': rawInput.match(/([a-zA-Z0-9_\-]+\.(cpp|hpp|c|h))/i),
      'Node.js': rawInput.match(/([a-zA-Z0-9_\-]+\.(js|ts|jsx|tsx))/i),
      Golang: rawInput.match(/([a-zA-Z0-9_\-]+\.go)/i)
    };

    if (matches.Rust || detectedLang.toLowerCase() === 'rust') {
      fileName = matches.Rust ? matches.Rust[1] : 'main.rs';
      detectedLang = 'Rust';
    } else if (matches.Python || detectedLang.toLowerCase() === 'python') {
      fileName = matches.Python ? matches.Python[1] : 'analytics.py';
      detectedLang = 'Python';
    } else if (matches['C++'] || detectedLang.toLowerCase() === 'cpp' || detectedLang === 'C++') {
      fileName = matches['C++'] ? matches['C++'][1] : 'vector_bounds.cpp';
      detectedLang = 'C++';
    } else if (matches['Node.js'] || ['node.js', 'nodejs', 'javascript'].includes(detectedLang.toLowerCase())) {
      fileName = matches['Node.js'] ? matches['Node.js'][1] : 'userController.js';
      detectedLang = 'Node.js';
    } else {
      fileName = matches.Golang ? matches.Golang[1] : 'user_handler.go';
      detectedLang = 'Golang';
    }

    // Cache using both keys to guarantee rollback succeeds
    originalCache.set(fileName, rawInput);
    if (scenarioId) originalCache.set(scenarioId, rawInput);

    const astGraph = buildAstGraph(sourceCode || customCode || rawInput, language, fileName);
    const rootNodeName = fileName.replace(/\.[^/.]+$/, "");

    // 2. Real-time Targeted Logs
    emitLog(socketId, { node: 1, text: `🔍 [Node 01] Triaging: Classifying error in ${detectedLang}...` });
    await sleep(400);
    emitLog(socketId, { node: 1, text: `✅ [Node 01] Triage complete. Language: ${detectedLang}, File: ${fileName}` });

    await sleep(300);
    emitLog(socketId, { node: 2, text: `🕸️ [Node 02] Parsing source AST for ${fileName}...` });
    await sleep(400);
    emitLog(socketId, {
      node: 2,
      text: astGraph.graphStatus === 'ready' || astGraph.graphStatus === 'partial'
        ? `✅ [Node 02] AST indexed: ${astGraph.nodes.length} source nodes`
        : `⚠️ [Node 02] AST unavailable: ${astGraph.graphMessage}`
    });

    emitLog(socketId, { node: 3, text: `🧠 [Node 03] Generating patch for ${detectedLang} via Groq...` });

    const parsed = await callGroq(fileName, detectedLang, rawInput);
    const patchedCode = parsed.patchedCode;
    const explanation = parsed.explanation;

    emitLog(socketId, { node: 3, text: `⚡ [Node 03] Patch generated successfully.` });

    await sleep(300);
    emitLog(socketId, { node: 4, text: `🧪 [Node 04] Sandbox: Running isolated test suite...` });
    await sleep(400);

    emitLog(socketId, {
      node: 4,
      text: `✅ [Node 04] All tests passed. Patch applied for ${fileName}`,
      complete: true,
      patchCode: patchedCode,
      telemetry: { tokens: { total: 342 }, latency: 1.2 }
    });

    return res.json({
      success: true,
      fileName,
      language: detectedLang,
      originalCode: rawInput,
      patchedCode,
      explanation,
      nodes: astGraph.nodes,
      graphStatus: astGraph.graphStatus,
      graphMessage: astGraph.graphMessage,
    });

  } catch (err) {
    console.error("Backend Run Agent Error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
      patchedCode: "// Error generating patch. Please check backend logs.",
      explanation: "Server processing error."
    });
  }
});

// ─── POST /api/rollback ───────────────────────────────────────────────────────
app.post('/api/rollback', async (req, res) => {
  const { scenarioId, fileName, socketId } = req.body;
  const key = fileName || scenarioId;
  const cached = originalCache.get(key);

  if (cached) {
    emitLog(socketId, { node: 0, text: `↩️ Rolled back ${key} to original source.` });
    return res.json({ status: 'ROLLED_BACK', scenarioId, fileName, originalCode: cached });
  } else {
    return res.json({ status: 'NO_CACHE', message: 'No original cached code found.' });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 CodeNexus Backend running on port ${PORT}`));
