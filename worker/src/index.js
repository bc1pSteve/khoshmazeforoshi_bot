const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const ORDER_BUTTON_TEXT = "📦 پیگیری وضعیت سفارش";
const ORDER_ID_PROMPT = "لطفا شماره سفارش خود را وارد کنید";
const INVALID_ORDER_ID_TEXT = "شماره سفارش وارد شده اشتباه است";
const ORDER_PHONE_PROMPT = "شماره موبایلی که با آن سفارش را ثبت کردید وارد کنید.";
const INVALID_ORDER_PHONE_TEXT = [
  "شماره موبایل وارد شده اشتباه است.",
  "باید همان شماره که با آن سفارش ثبت شده را وارد نمایید.",
].join("\n");
const ORDER_NOT_FOUND_TEXT = "سفارش با این مشخصات یافت نشد";
const ORDER_STATE_URL_PREFIX = "https://t.me/#khosh-order-";

const ORDER_STATUS_LABELS = {
  pending: "در انتظار پرداخت",
  processing: "در حال پردازش",
  "on-hold": "در انتظار بررسی",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
  refunded: "بازپرداخت شده",
  failed: "ناموفق",
  "checkout-draft": "ثبت موقت",
};

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

function toEnglishDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function normalizeOrderId(value) {
  const normalized = toEnglishDigits(value).trim();
  if (!/^\d{1,12}$/.test(normalized)) return null;
  return normalized.replace(/^0+(?=\d)/, "");
}

function normalizeIranianMobile(value) {
  let digits = toEnglishDigits(value).replace(/\D/g, "");
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^9\d{9}$/.test(digits) ? digits : null;
}

function mainMenu() {
  return {
    keyboard: [[{ text: ORDER_BUTTON_TEXT }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "یکی از گزینه‌ها را انتخاب کنید",
  };
}

function forceReply(placeholder) {
  return {
    force_reply: true,
    selective: true,
    input_field_placeholder: placeholder,
  };
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

function wooCommerceUrl(orderId, env) {
  const baseUrl = new URL(String(env.WOOCOMMERCE_BASE_URL || ""));
  if (baseUrl.protocol !== "https:") {
    throw new Error("WooCommerce base URL must use HTTPS");
  }
  baseUrl.username = "";
  baseUrl.password = "";
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/wp-json/wc/v3/orders/${orderId}`;
  baseUrl.searchParams.set("_fields", "id,status,billing");
  return baseUrl.toString();
}

async function getWooCommerceOrder(orderId, env, fetchImpl) {
  if (!env.WOOCOMMERCE_CONSUMER_KEY || !env.WOOCOMMERCE_CONSUMER_SECRET) {
    throw new Error("WooCommerce credentials are not configured");
  }

  const credentials = btoa(
    `${env.WOOCOMMERCE_CONSUMER_KEY}:${env.WOOCOMMERCE_CONSUMER_SECRET}`,
  );
  const response = await fetchImpl(wooCommerceUrl(orderId, env), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
    },
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error("WooCommerce request redirected; check the canonical store URL");
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`WooCommerce request failed (${response.status})`);
  }

  const payload = await response.json();
  if (!payload || String(payload.id) !== orderId || typeof payload.status !== "string") {
    throw new Error("WooCommerce returned an invalid order response");
  }
  return payload;
}

function orderIdEntity(text, orderId) {
  return [{
    type: "text_link",
    offset: text.length - 1,
    length: 1,
    url: `${ORDER_STATE_URL_PREFIX}${orderId}`,
  }];
}

function orderIdFromPhonePrompt(message) {
  const prompt = String(message?.text || "");
  if (prompt !== ORDER_PHONE_PROMPT && prompt !== INVALID_ORDER_PHONE_TEXT) {
    const legacyOrderId = prompt.match(/#(\d{1,12})/)?.[1];
    return normalizeOrderId(legacyOrderId);
  }

  const stateEntity = message?.entities?.find(
    (entity) => entity.type === "text_link"
      && String(entity.url || "").startsWith(ORDER_STATE_URL_PREFIX),
  );
  if (!stateEntity) return null;
  return normalizeOrderId(String(stateEntity.url).slice(ORDER_STATE_URL_PREFIX.length));
}

async function requestOrderId(chatId, env, fetchImpl, invalid = false) {
  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: invalid ? INVALID_ORDER_ID_TEXT : ORDER_ID_PROMPT,
      reply_markup: forceReply("شماره سفارش"),
    },
    env,
    fetchImpl,
  );
}

async function requestOrderPhone(chatId, orderId, env, fetchImpl, invalid = false) {
  const text = invalid ? INVALID_ORDER_PHONE_TEXT : ORDER_PHONE_PROMPT;
  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      entities: orderIdEntity(text, orderId),
      reply_markup: forceReply("شماره موبایل ثبت‌شده در سفارش"),
    },
    env,
    fetchImpl,
  );
}

async function sendOrderStatus(chatId, orderId, phone, env, fetchImpl) {
  let order;
  try {
    order = await getWooCommerceOrder(orderId, env, fetchImpl);
  } catch (error) {
    console.error(JSON.stringify({
      event: "woocommerce_order_lookup_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: "سرویس پیگیری سفارش موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.",
        reply_markup: mainMenu(),
      },
      env,
      fetchImpl,
    );
    return;
  }

  const billingPhone = normalizeIranianMobile(order?.billing?.phone);
  if (!order || !billingPhone || !await safeEqual(phone, billingPhone)) {
    await telegram(
      "sendMessage",
      { chat_id: chatId, text: ORDER_NOT_FOUND_TEXT, reply_markup: mainMenu() },
      env,
      fetchImpl,
    );
    return;
  }

  const status = ORDER_STATUS_LABELS[String(order.status).replace(/^wc-/, "")]
    || "در حال بررسی";
  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: `وضعیت سفارش #${orderId}: ${status}`,
      reply_markup: mainMenu(),
    },
    env,
    fetchImpl,
  );
}

async function handleMessage(message, env, fetchImpl) {
  if (message.chat?.type !== "private") return;

  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  const pieces = text.split(/\s+/);
  const command = (pieces.shift() || "").split("@")[0].toLowerCase();
  const admin = isAdmin(message.from?.id, env);

  if (command === "/start" || command === "/help") {
    const lines = [
      "سلام. به ربات خوشمزه فروشی خوش آمدید.",
      "چه کمکی میتونم بهتون بکنم؟",
    ];
    if (admin) {
      lines.push(
        "",
        "فرمان‌های مدیریت:",
        "/post PRODUCT_ID — آماده‌سازی ارسال محصول",
        "/last — وضعیت آخرین اجرا",
      );
    }
    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: lines.join("\n"),
        reply_markup: mainMenu(),
      },
      env,
      fetchImpl,
    );
    return;
  }

  if (text === ORDER_BUTTON_TEXT || command === "/order") {
    await requestOrderId(chatId, env, fetchImpl);
    return;
  }

  const repliedTo = String(message.reply_to_message?.text || "");
  if (repliedTo === ORDER_ID_PROMPT || repliedTo === INVALID_ORDER_ID_TEXT) {
    const orderId = normalizeOrderId(text);
    if (!orderId) {
      await requestOrderId(chatId, env, fetchImpl, true);
      return;
    }
    await requestOrderPhone(chatId, orderId, env, fetchImpl);
    return;
  }

  const orderId = orderIdFromPhonePrompt(message.reply_to_message);
  if (orderId) {
    const phone = normalizeIranianMobile(text);
    if (!phone) {
      await requestOrderPhone(chatId, orderId, env, fetchImpl, true);
      return;
    }
    await sendOrderStatus(chatId, orderId, phone, env, fetchImpl);
    return;
  }

  if (command === "/post") {
    if (!admin) return;
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
    if (!admin) return;
    const run = await getLastRun(env, fetchImpl);
    const text = run
      ? `آخرین اجرا: ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}\n${run.html_url}`
      : "هنوز اجرایی ثبت نشده است.";
    await telegram("sendMessage", { chat_id: chatId, text }, env, fetchImpl);
    return;
  }

  await telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text: "برای پیگیری سفارش، دکمه زیر را بزنید.",
      reply_markup: mainMenu(),
    },
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
