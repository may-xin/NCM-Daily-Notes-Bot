const qrImage = document.getElementById("qrImage");
const qrStatus = document.getElementById("qrStatus");
const refreshBtn = document.getElementById("refreshBtn");
const noteForm = document.getElementById("noteForm");
const noteInput = document.getElementById("noteInput");
const noteResult = document.getElementById("noteResult");
const logoutBtn = document.getElementById("logoutBtn");
const scheduleForm = document.getElementById("scheduleForm");
const scheduleInput = document.getElementById("scheduleInput");
const scheduleInfo = document.getElementById("scheduleInfo");
const historyList = document.getElementById("historyList");

let qrKey = null;
let pollTimer = null;

function setStatus(text, tone = "") {
  qrStatus.textContent = text;
  qrStatus.className = `status ${tone}`.trim();
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "请求失败");
  }
  return data;
}

async function getQrKey() {
  const data = await fetchJson("/api/qr/key");
  return data?.data?.unikey;
}

async function createQr(key) {
  const data = await fetchJson(`/api/qr/create?key=${encodeURIComponent(key)}`);
  return data?.data?.qrimg;
}

async function checkQr(key) {
  return fetchJson(`/api/qr/check?key=${encodeURIComponent(key)}`);
}

function clearPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function startQrFlow() {
  clearPoll();
  setStatus("生成二维码中…", "pending");
  qrImage.removeAttribute("src");

  try {
    qrKey = await getQrKey();
    const qrimg = await createQr(qrKey);
    qrImage.src = qrimg;
    setStatus("请扫码登录", "pending");

    pollTimer = setInterval(async () => {
      try {
        const result = await checkQr(qrKey);
        switch (result.code) {
          case 800:
            setStatus("二维码已过期，请刷新", "warn");
            clearPoll();
            break;
          case 801:
            setStatus("等待扫码…", "pending");
            break;
          case 802:
            setStatus("已扫码，等待确认…", "pending");
            break;
          case 803:
            setStatus("登录成功，可以发布笔记", "success");
            clearPoll();
            break;
          default:
            setStatus(`状态未知：${result.code}`, "warn");
        }
      } catch (error) {
        setStatus(`轮询失败：${error.message}`, "warn");
        clearPoll();
      }
    }, 2000);
  } catch (error) {
    setStatus(`生成失败：${error.message}`, "warn");
  }
}

refreshBtn.addEventListener("click", () => {
  startQrFlow();
});

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  noteResult.textContent = "";

  const msg = noteInput.value.trim();
  if (!msg) {
    noteResult.textContent = "请输入内容";
    return;
  }

  try {
    const data = await fetchJson("/api/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg })
    });
    noteResult.textContent = pretty(data);
    await loadHistory();
  } catch (error) {
    noteResult.textContent = `发布失败：${error.message}`;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/api/logout", { method: "POST" });
    setStatus("已退出登录，请重新扫码", "warn");
    noteResult.textContent = "";
    startQrFlow();
  } catch (error) {
    noteResult.textContent = `退出失败：${error.message}`;
  }
});

async function loadSchedule() {
  try {
    const data = await fetchJson("/api/schedule");
    scheduleInput.value = data.msg || "";
    scheduleInfo.textContent = `下一次发布：${formatTime(data.nextRun)}（${data.timezone}）`;
    scheduleInfo.className = "status pending";
  } catch (error) {
    scheduleInfo.textContent = `读取失败：${error.message}`;
    scheduleInfo.className = "status warn";
  }
}

scheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const msg = scheduleInput.value.trim();
    const data = await fetchJson("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg })
    });
    scheduleInfo.textContent = `已保存，下一次发布：${formatTime(data.nextRun)}`;
    scheduleInfo.className = "status success";
  } catch (error) {
    scheduleInfo.textContent = `保存失败：${error.message}`;
    scheduleInfo.className = "status warn";
  }
});

async function loadHistory() {
  try {
    const data = await fetchJson("/api/history");
    historyList.innerHTML = "";
    if (!data.items || data.items.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "暂无历史记录";
      empty.className = "history-empty";
      historyList.appendChild(empty);
      return;
    }
    data.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.ok ? "history-item ok" : "history-item fail";
      li.innerHTML = `
        <div class="history-meta">
          <span>${formatTime(item.ts)}</span>
          <span>${item.source === "scheduled" ? "定时" : "手动"}</span>
          <span>${item.ok ? "成功" : "失败"}</span>
        </div>
        <div class="history-msg"></div>
      `;
      li.querySelector(".history-msg").textContent = item.msg;
      historyList.appendChild(li);
    });
  } catch (error) {
    historyList.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = `加载失败：${error.message}`;
    li.className = "history-empty";
    historyList.appendChild(li);
  }
}

startQrFlow();
loadSchedule();
loadHistory();
