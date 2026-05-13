import express from "express";
import session from "express-session";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const API_BASE = (process.env.NCM_API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const TIMEZONE = process.env.TZ || "Asia/Shanghai";

const app = express();
const DATA_DIR = path.join(__dirname, "data");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

process.env.TZ = TIMEZONE;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function buildUrl(apiPath, params = {}) {
  const url = new URL(apiPath, API_BASE);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function apiRequest(apiPath, { method = "GET", params, body, cookie } = {}) {
  const requestParams = { ...(params || {}) };
  const requestBody = body ? { ...body } : undefined;
  const headers = {};

  if (cookie) {
    headers["Cookie"] = cookie;
    if (method === "GET") {
      requestParams.cookie = cookie;
    } else if (requestBody) {
      requestBody.cookie = cookie;
    }
  }

  const url = buildUrl(apiPath, requestParams);

  let encodedBody;
  if (requestBody) {
    encodedBody = new URLSearchParams(requestBody);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: encodedBody
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getNextRunTimestamp() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

let savedCookie = null;
let scheduledMessage = "";
let history = [];

async function loadState() {
  await ensureDataDir();
  const auth = await readJson(AUTH_FILE, { cookie: null });
  savedCookie = auth.cookie || null;

  const schedule = await readJson(SCHEDULE_FILE, { msg: "" });
  scheduledMessage = schedule.msg || "";

  const historyData = await readJson(HISTORY_FILE, { items: [] });
  history = Array.isArray(historyData.items) ? historyData.items : [];
}

async function saveAuth(cookie) {
  savedCookie = cookie;
  await writeJson(AUTH_FILE, { cookie });
}

async function clearAuth() {
  savedCookie = null;
  await writeJson(AUTH_FILE, { cookie: null });
}

async function saveSchedule(msg) {
  scheduledMessage = msg;
  await writeJson(SCHEDULE_FILE, { msg });
}

async function addHistory(entry) {
  history.unshift(entry);
  history = history.slice(0, 100);
  await writeJson(HISTORY_FILE, { items: history });
}

async function publishNote({ msg, source, cookieOverride }) {
  const cookieToUse = cookieOverride || savedCookie;
  if (!cookieToUse) {
    throw new Error("缺少登录态 cookie");
  }

  const result = await apiRequest("/share/resource", {
    method: "POST",
    body: {
      type: "noresource",
      msg: msg.trim(),
      timestamp: Date.now()
    },
    cookie: cookieToUse
  });

  await addHistory({
    id: `note_${Date.now()}`,
    ts: Date.now(),
    msg: msg.trim(),
    source,
    ok: result?.code === 200,
    result
  });

  return result;
}

app.get("/api/qr/key", async (req, res) => {
  try {
    const data = await apiRequest("/login/qr/key", {
      params: { timestamp: Date.now() }
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/qr/create", async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    const data = await apiRequest("/login/qr/create", {
      params: {
        key,
        qrimg: 1,
        timestamp: Date.now()
      }
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/qr/check", async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    let data = await apiRequest("/login/qr/check", {
      params: {
        key,
        timestamp: Date.now()
      }
    });

    if (data?.code === 502) {
      data = await apiRequest("/login/qr/check", {
        params: {
          key,
          noCookie: true,
          timestamp: Date.now()
        }
      });
    }

    if (data?.code === 803 && data?.cookie) {
      req.session.ncmCookie = data.cookie;
      req.session.save(() => {});
      await saveAuth(data.cookie);
    }

    res.json({
      ...data,
      authenticated: Boolean(req.session.ncmCookie)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/note", async (req, res) => {
  try {
    const { msg } = req.body;
    if (!msg || typeof msg !== "string") {
      return res.status(400).json({ error: "Missing msg" });
    }
    if (!req.session.ncmCookie) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const data = await publishNote({
      msg,
      source: "manual",
      cookieOverride: req.session.ncmCookie
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/schedule", (req, res) => {
  res.json({
    msg: scheduledMessage,
    nextRun: getNextRunTimestamp(),
    timezone: TIMEZONE
  });
});

app.post("/api/schedule", async (req, res) => {
  try {
    const { msg } = req.body;
    if (typeof msg !== "string") {
      return res.status(400).json({ error: "Missing msg" });
    }
    await saveSchedule(msg.trim());
    res.json({ ok: true, msg: scheduledMessage, nextRun: getNextRunTimestamp() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/history", (req, res) => {
  res.json({
    items: history.slice(0, 10)
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(async () => {
    await clearAuth();
    res.json({ ok: true });
  });
});

async function start() {
  await loadState();

  cron.schedule(
    "0 3 * * *",
    async () => {
      if (!scheduledMessage) {
        return;
      }
      try {
        await publishNote({ msg: scheduledMessage, source: "scheduled" });
        console.log(`[cron] Sent scheduled note at ${new Date().toLocaleString()}`);
      } catch (error) {
        console.error(`[cron] Failed to send scheduled note: ${error.message}`);
        await addHistory({
          id: `note_${Date.now()}`,
          ts: Date.now(),
          msg: scheduledMessage,
          source: "scheduled",
          ok: false,
          result: { error: error.message }
        });
      }
    },
    { timezone: TIMEZONE }
  );

  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
    console.log(`Using API base: ${API_BASE}`);
    console.log(`Scheduler time zone: ${TIMEZONE}, next run at ${new Date(getNextRunTimestamp()).toLocaleString()}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
