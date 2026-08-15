const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

async function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return false;

  const encoder = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let difference = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    difference |= aBytes[index] ^ bBytes[index];
  }
  return difference === 0;
}

function isAdmin(userId, env) {
  return String(userId || "") === String(env.TELEGRAM_ADMIN_USER_ID || "");
}

function validProductId(value) {
  if (!value || value.includes(":")) return false;
  const bytes = new TextEncoder().encode(value);
  return !/\s/.test(value) && bytes.length <= 48;
}

async function telegram(method, payload, env, fetchImpl) {
  const response = await fetchImpl(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API returned ${response.status}`);
  }
  return result;
}

async function dispatchWorkflow(productId, chatId, env, fetchImpl) {
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW || "post.yml");
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "khoshmazeforoshi-telegram-controller",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: env.GITHUB_REF || "main",
      inputs: {
        product_id: productId,
        request_chat_id: String(chatId),
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub dispatch failed (${response.status}): ${details.slice(0, 200)}`);
  }
}

async function getLastRun(env, fetchImpl) {
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW || "post.yml");
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=1`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "khoshmazeforoshi-telegram-controller",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub status request failed (${response.status})`);
  }
  const payload = await response.json();
  return payload.workflow_runs?.[0] || null;
}

async function handleMessage(message, env, fetchImpl) {
  if (!isAdmin(message.from?.id, env) || message.chat?.type !== "private") return;

  const chatId = message.chat.id;
  const pieces = String(message.text || "").trim().split(/\s+/);
  const command = (pieces.shift() || "").split("@")[0].toLowerCase();

  if (command === "/start" || command === "/help") {
    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: [
          "فرمان‌های مدیریت ارسال:",
          "",
          "/post PRODUCT_ID — آماده‌سازی ارسال محصول",
          "/last — وضعیت آخرین اجرا",
          "/help — نمایش راهنما",
        ].join("\n"),
      },
      env,
      fetchImpl,
    );
    return;
  }

  if (command === "/post") {
    const productId = pieces[0];
    if (!validProductId(productId)) {
      await telegram(
        "sendMessage",
        { chat_id: chatId, text: "فرمت درست: /post P001" },
        env,
        fetchImpl,
      );
      return;
    }

    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: `محصول ${productId} به تلگرام و بله ارسال شود؟`,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ تأیید ارسال", callback_data: `post:${productId}` },
            { text: "❌ لغو", callback_data: `cancel:${productId}` },
          ]],
        },
      },
      env,
      fetchImpl,
    );
    return;
  }

  if (command === "/last") {
    const run = await getLastRun(env, fetchImpl);
    const text = run
      ? `آخرین اجرا: ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}\n${run.html_url}`
      : "هنوز اجرایی ثبت نشده است.";
    await telegram("sendMessage", { chat_id: chatId, text }, env, fetchImpl);
    return;
  }

  await telegram(
    "sendMessage",
    { chat_id: chatId, text: "فرمان شناخته نشد. /help را بفرست." },
    env,
    fetchImpl,
  );
}

async function handleCallback(query, env, fetchImpl) {
  if (!isAdmin(query.from?.id, env)) return;

  const [action, productId] = String(query.data || "").split(":", 2);
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId || !validProductId(productId)) return;

  await telegram(
    "answerCallbackQuery",
    { callback_query_id: query.id },
    env,
    fetchImpl,
  );

  if (action === "cancel") {
    await telegram(
      "editMessageText",
      { chat_id: chatId, message_id: messageId, text: `ارسال ${productId} لغو شد.` },
      env,
      fetchImpl,
    );
    return;
  }

  if (action !== "post") return;

  await dispatchWorkflow(productId, chatId, env, fetchImpl);
  await telegram(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text: `درخواست ارسال ${productId} ثبت شد. نتیجه همین‌جا اعلام می‌شود.`,
    },
    env,
    fetchImpl,
  );
}

async function handleUpdate(update, env, fetchImpl) {
  if (update.message) return handleMessage(update.message, env, fetchImpl);
  if (update.callback_query) return handleCallback(update.callback_query, env, fetchImpl);
}

export async function handleRequest(request, env, fetchImpl = globalThis.fetch) {
  if (request.method === "GET") {
    return new Response("Telegram controller is running", { status: 200 });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!await safeEqual(
    request.headers.get(TELEGRAM_SECRET_HEADER),
    env.TELEGRAM_WEBHOOK_SECRET,
  )) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    await handleUpdate(update, env, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "telegram_update_failed",
      update_id: update?.update_id ?? null,
      error: message,
    }));

    const adminId = env.TELEGRAM_ADMIN_USER_ID;
    if (adminId) {
      await telegram(
        "sendMessage",
        { chat_id: adminId, text: `❌ خطای کنترل‌کننده: ${message}` },
        env,
        fetchImpl,
      ).catch(() => {});
    }
  }

  return new Response("ok", { status: 200 });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
