const TASKS = new Set([
  "general", "reasoning", "writing", "research", "math", "study", "coding",
  "security", "data", "translation", "summarization", "planning", "creative",
  "health", "legal", "finance", "travel", "shopping", "presentation"
]);
const SHORTCUTS = {
  ask: "general", do: "general", code: "coding", study: "study", math: "math",
  write: "writing", think: "reasoning", research: "research", security: "security",
  data: "data", translate: "translation", summarize: "summarization", plan: "planning",
  creative: "creative", travel: "travel", shop: "shopping", present: "presentation",
  health: "health", legal: "legal", finance: "finance"
};
const API = "https://api.github.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function timingSafeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function splitText(s, max = 3900) {
  const chars = Array.from(String(s || ""));
  const parts = [];
  while (chars.length) parts.push(chars.splice(0, max).join(""));
  return parts.length ? parts : [""];
}
async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(`Telegram API ${method} failed (${r.status}): ${String(d.description || "unknown error").slice(0, 180)}`);
  return d.result;
}
async function send(env, chatId, text) {
  for (const part of splitText(text)) await tg(env, "sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true });
}
function parseArgs(s) {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\([\\"'])/g, "$1"));
  return out;
}
function validRepo(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Repository URL is invalid."); }
  const allowed = new Set(["github.com", "gitlab.com", "android.googlesource.com"]);
  if (u.protocol !== "https:" || !allowed.has(u.hostname.toLowerCase()) || u.username || u.password || u.search || u.hash || u.port && u.port !== "443") {
    throw new Error("Use a public HTTPS repository on github.com, gitlab.com or android.googlesource.com. No embedded credentials or query strings.");
  }
  const path = u.pathname.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").some(x => !x || x === "." || x === "..")) throw new Error("Repository path is invalid.");
  return u.toString().replace(/\/$/, "");
}
function validBranch(s) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(s) || s.includes("..") || s.endsWith("/")) throw new Error("Branch name is invalid.");
  return s;
}
function validName(s) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,59}$/.test(s) || s === "..") throw new Error("Workspace name must use 2-60 letters, numbers, dot, underscore or hyphen.");
  return s;
}
function configName(s) {
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*_defconfig$/.test(s) || s.split("/").includes("..")) throw new Error("Defconfig must be a safe path ending in _defconfig.");
  return s;
}
async function github(env, path, options = {}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) throw new Error("GitHub integration is not configured in the Cloudflare Gateway.");
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json", authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28", "user-agent": "Jarvis-Free-Builder-Gateway", ...(options.headers || {})
    }, signal: AbortSignal.timeout(20000)
  });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub API failed (${r.status}): ${String(body.message || "request rejected").slice(0, 220)}`);
  return body;
}
async function dispatch(env, workflow, inputs) {
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const ref = env.GITHUB_REF || "main";
  await github(env, `/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref, inputs: { ...inputs, request_id: crypto.randomUUID() } })
  });
}
async function askJarvis(env, userId, prompt, task, research) {
  if (!env.JARVIS_WORKER_URL || !env.JARVIS_TELEGRAM_SECRET) throw new Error("Jarvis Worker connection is not configured.");
  const base = String(env.JARVIS_WORKER_URL).replace(/\/$/, "");
  const r = await fetch(`${base}/api/bot/chat`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.JARVIS_TELEGRAM_SECRET}` },
    body: JSON.stringify({ telegramUserId: String(userId), message: prompt.slice(0, 5000), task, webSearch: research }),
    signal: AbortSignal.timeout(26000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d.error || `Jarvis returned HTTP ${r.status}`).slice(0, 600));
  return String(d.answer || "Jarvis returned an empty response.");
}
async function resetJarvis(env, userId) {
  const base = String(env.JARVIS_WORKER_URL || "").replace(/\/$/, "");
  if (!base || !env.JARVIS_TELEGRAM_SECRET) throw new Error("Jarvis Worker connection is not configured.");
  const r = await fetch(`${base}/api/bot/reset`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.JARVIS_TELEGRAM_SECRET}` },
    body: JSON.stringify({ telegramUserId: String(userId) }), signal: AbortSignal.timeout(15000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d.error || `Jarvis returned HTTP ${r.status}`));
}
function help() {
  return [
    "JARVIS · FREE-CI TELEGRAM GATEWAY",
    "General AI is routed to your existing Jarvis Worker. Compiler jobs use GitHub's public runners.",
    "",
    "AI: send a plain message, or use /ask, /research, /task <mode> <prompt>.",
    "Modes: general, reasoning, writing, research, math, study, coding, security, data, translation, summarization, planning, creative, health, legal, finance, travel, shopping, presentation.",
    "Shortcuts: /code /study /math /write /think /data /translate /summarize /plan /creative /travel /shop /present /security /health /legal /finance.",
    "Conversation: /new resets Telegram chat history in Jarvis.",
    "",
    "Kernel: /kernelrepo <https-repo> <branch> <arm64_defconfig> [workspace]",
    "Zygisk: /zygiskrepo <https-repo> <branch> [workspace] [abi-list]",
    "APatch KPM: /kpmrepo <https-repo> <branch> [workspace] [kpms/subdir]",
    "Build status: /status. Details: /job <run-id>.",
    "",
    "AOSP: /aosp needs AOSP_SELF_HOSTED_ENABLED=true and a registered 64 GB / 400 GB self-hosted x86-64 runner; it is disabled by default. Current AOSP baseline: 64 GB RAM + 400 GB free disk. Use university HPC or an authorized self-hosted runner.",
    "",
    "Only public repositories are accepted. Build commands immediately dispatch a workflow on your owner-only bot request. Review source code before running it."
  ].join("\n");
}
async function statusText(env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER), repo = encodeURIComponent(env.GITHUB_REPO);
  const d = await github(env, `/repos/${owner}/${repo}/actions/runs?per_page=8`);
  const runs = d.workflow_runs || [];
  if (!runs.length) return "No GitHub Actions runs found yet.";
  return "RECENT BUILDS\n\n" + runs.map(x => `#${x.id} · ${x.name}\n${x.status}${x.conclusion ? " / " + x.conclusion : ""}\n${x.html_url}`).join("\n\n");
}
async function jobText(env, id) {
  if (!/^\d{1,20}$/.test(id)) throw new Error("Run ID must be numeric. Use /status to find it.");
  const owner = encodeURIComponent(env.GITHUB_OWNER), repo = encodeURIComponent(env.GITHUB_REPO);
  const r = await github(env, `/repos/${owner}/${repo}/actions/runs/${id}`);
  return `BUILD #${r.id}\n${r.name}\nStatus: ${r.status}\nResult: ${r.conclusion || "pending"}\nBranch: ${r.head_branch}\nStarted: ${r.run_started_at || "not started"}\nUpdated: ${r.updated_at}\n${r.html_url}`;
}
async function handleText(env, message) {
  const fromId = String(message.from?.id || "");
  const chatId = message.chat?.id;
  if (!fromId || fromId !== String(env.TELEGRAM_OWNER_ID) || String(chatId) !== String(env.TELEGRAM_OWNER_ID) || message.chat?.type !== "private") return;
  const raw = String(message.text || "").trim();
  if (!raw) return;
  const firstSpace = raw.indexOf(" ");
  let command = (firstSpace < 0 ? raw : raw.slice(0, firstSpace)).split("@")[0].toLowerCase();
  const argument = firstSpace < 0 ? "" : raw.slice(firstSpace + 1).trim();
  if (command === "/start" || command === "/help") return send(env, chatId, help());
  if (command === "/new") { await resetJarvis(env, fromId); return send(env, chatId, "Jarvis Telegram conversation reset. Saved profile memories were not deleted."); }
  if (command === "/status") return send(env, chatId, await statusText(env));
  if (command === "/job") {
    const [id] = parseArgs(argument); if (!id) throw new Error("Usage: /job <GitHub Actions run-id>");
    return send(env, chatId, await jobText(env, id));
  }
  const args = parseArgs(argument);
  if (command === "/aosp") {
    if (env.AOSP_SELF_HOSTED_ENABLED !== "true") return send(env, chatId, "A full AOSP build cannot be responsibly run on the free GitHub-hosted runner: it has 16 GB RAM and 14 GB SSD, while Google's current AOSP baseline is 64 GB RAM and 400 GB free disk. Your 12 GB/i3 PC is also below that baseline. Use university HPC / a lab x86-64 Linux server with at least 64 GB RAM and 400 GB free disk. After registering a trusted GitHub self-hosted runner with the label aosp64, an administrator can enable AOSP_SELF_HOSTED_ENABLED=true in this Gateway.");
    if (args.length < 3 || args.length > 5) throw new Error("Usage: /aosp <manifest-https-url> <branch> <lunch-target> [workspace] [goal]");
    const manifest_url = validRepo(args[0]), branch = validBranch(args[1]);
    if (!/^[A-Za-z0-9_.+-]{3,120}$/.test(args[2])) throw new Error("Invalid lunch target.");
    const workspace_name = validName(args[3] || "aosp-build");
    const goal = args[4] || "all";
    if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(goal)) throw new Error("Invalid build goal.");
    await dispatch(env, "aosp-self-hosted.yml", { manifest_url, branch, lunch_target: args[2], workspace_name, build_goal: goal });
    return send(env, chatId, `AOSP job dispatched to your configured self-hosted runner. It will remain queued until that runner is online.
Manifest: ${manifest_url}
Branch: ${branch}
Lunch: ${args[2]}
Goal: ${goal}
Use /status to monitor it.`);
  }
  if (command === "/kernelrepo") {
    if (args.length < 3 || args.length > 4) throw new Error("Usage: /kernelrepo <https-repo> <branch> <arm64_defconfig> [workspace]");
    const repo_url = validRepo(args[0]), branch = validBranch(args[1]), defconfig = configName(args[2]);
    const workspace_name = validName(args[3] || "kernel-build");
    await dispatch(env, "kernel-build.yml", { repo_url, branch, defconfig, workspace_name, build_jobs: "2" });
    return send(env, chatId, `Kernel build dispatched to GitHub Actions.\nRepository: ${repo_url}\nBranch: ${branch}\nDefconfig: ${defconfig}\nWorkspace: ${workspace_name}\nUse /status to find the run ID. Build output will be sent back here when finished.`);
  }
  if (command === "/zygiskrepo") {
    if (args.length < 2 || args.length > 4) throw new Error("Usage: /zygiskrepo <https-repo> <branch> [workspace] [arm64-v8a,armeabi-v7a]");
    const repo_url = validRepo(args[0]), branch = validBranch(args[1]);
    const workspace_name = validName(args[2] || "zygisk-module");
    const abis = (args[3] || "arm64-v8a").split(",");
    if (!abis.length || abis.some(x => !["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].includes(x))) throw new Error("Unsupported ABI. Use arm64-v8a, armeabi-v7a, x86 or x86_64.");
    await dispatch(env, "zygisk-build.yml", { repo_url, branch, workspace_name, abis: abis.join(",") });
    return send(env, chatId, `Zygisk build dispatched.\n${repo_url}\n${branch}\nABIs: ${abis.join(", ")}\nUse /status to find the run ID. Output will be sent here.`);
  }
  if (command === "/kpmrepo") {
    if (args.length < 2 || args.length > 4) throw new Error("Usage: /kpmrepo <https-repo> <branch> [workspace] [kpms/subdir]");
    const repo_url = validRepo(args[0]), branch = validBranch(args[1]);
    const workspace_name = validName(args[2] || "kernelpatch");
    const project_subdir = args[3] || "kpms";
    if (!/^[A-Za-z0-9_.\/-]{1,120}$/.test(project_subdir) || project_subdir.split("/").includes("..")) throw new Error("KPM subdirectory path is invalid.");
    await dispatch(env, "kpm-build.yml", { repo_url, branch, workspace_name, project_subdir });
    return send(env, chatId, `APatch KPM build dispatched.\n${repo_url}\n${branch}\nProject: ${project_subdir}\nUse /status to find the run ID. Output will be sent here.`);
  }
  if (command === "/task") {
    const m = argument.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m || !TASKS.has(m[1].toLowerCase())) throw new Error("Usage: /task <mode> <prompt>. Use /help to list modes.");
    return send(env, chatId, await askJarvis(env, fromId, m[2], m[1].toLowerCase(), m[1].toLowerCase() === "research"));
  }
  if (command.startsWith("/")) {
    const key = command.slice(1);
    if (SHORTCUTS[key]) {
      if (!argument) throw new Error(`Usage: ${command} <prompt>`);
      return send(env, chatId, await askJarvis(env, fromId, argument, SHORTCUTS[key], SHORTCUTS[key] === "research"));
    }
    throw new Error("Unknown command. Send /help.");
  }
  return send(env, chatId, await askJarvis(env, fromId, raw, "general", false));
}
async function processUpdate(env, update) {
  const message = update?.message;
  if (!message || !message.text) return;
  if (String(message.from?.id || "") !== String(env.TELEGRAM_OWNER_ID) || String(message.chat?.id || "") !== String(env.TELEGRAM_OWNER_ID) || message.chat?.type !== "private") return;
  try { await tg(env, "sendChatAction", { chat_id: message.chat?.id, action: "typing" }); } catch {}
  try { await handleText(env, message); }
  catch (e) {
    try { await send(env, message.chat?.id, "Request failed: " + String(e?.message || e).slice(0, 900)); }
    catch (sendError) { console.error("Telegram reply failed", String(sendError).slice(0, 200)); }
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "jarvis-telegram-gateway", mode: "cloudflare-webhook", buildCompute: "github-actions-public-runners" });
    if (request.method !== "POST" || url.pathname !== "/telegram") return json({ error: "Not found" }, 404);
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_OWNER_ID) return json({ error: "Gateway is not configured" }, 503);
    if (!timingSafeEqual(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);
    let update;
    try { update = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (ctx?.waitUntil) ctx.waitUntil(processUpdate(env, update));
    else await processUpdate(env, update);
    return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  }
};

export { handleText, parseArgs, validRepo, validBranch, configName, timingSafeEqual };
