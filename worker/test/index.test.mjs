import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const ORDER_ID_PROMPT = "لطفا شماره سفارش خود را وارد کنید";
const ORDER_PHONE_PROMPT = "شماره موبایلی که با آن سفارش را ثبت کردید وارد کنید.";
const INVALID_ORDER_PHONE_TEXT = [
  "شماره موبایل وارد شده اشتباه است.",
  "باید همان شماره که با آن سفارش ثبت شده را وارد نمایید.",
].join("\n");

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async delete(key) {
    this.values.delete(key);
  }
}

const env = {
  TELEGRAM_BOT_TOKEN: "telegram-token",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  TELEGRAM_ADMIN_USER_ID: "42",
  GITHUB_TOKEN: "github-token",
  GITHUB_OWNER: "bc1pSteve",
  GITHUB_REPO: "khoshmazeforoshi_bot",
  GITHUB_WORKFLOW: "post.yml",
  GITHUB_REF: "main",
  WOOCOMMERCE_BASE_URL: "https://shop.example",
  WOOCOMMERCE_CONSUMER_KEY: "ck_read_only",
  WOOCOMMERCE_CONSUMER_SECRET: "cs_read_only",
  BALE_BOT_TOKEN: "bale-token",
  BALE_WEBHOOK_SECRET: "bale-webhook-secret",
};

function webhookRequest(update, secret = "webhook-secret") {
  return new Request("https://worker.example", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret,
    },
    body: JSON.stringify(update),
  });
}

function baleWebhookRequest(update, secret = "bale-webhook-secret") {
  return new Request(`https://worker.example/bale/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function telegramSuccess() {
  return jsonResponse({ ok: true, result: { message_id: 123 } });
}

function sentTelegramBody(calls, expectedText) {
  const call = calls.find((item) => {
    if (!item.url.includes("/sendMessage")) return false;
    return JSON.parse(item.options.body).text === expectedText;
  });
  assert.ok(call);
  return JSON.parse(call.options.body);
}

function phonePromptReply(orderId, text = ORDER_PHONE_PROMPT) {
  return {
    text,
    entities: [{
      type: "text_link",
      offset: text.length - 1,
      length: 1,
      url: `https://t.me/#khosh-order-${orderId}`,
    }],
  };
}

test("rejects a webhook with the wrong secret", async () => {
  let calls = 0;
  const response = await handleRequest(
    webhookRequest({}, "wrong-secret"),
    env,
    async () => { calls += 1; },
  );

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("rejects a webhook when the configured secret is missing", async () => {
  let calls = 0;
  const response = await handleRequest(
    webhookRequest({}, ""),
    { ...env, TELEGRAM_WEBHOOK_SECRET: "" },
    async () => { calls += 1; },
  );

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("ignores admin commands from non-admin users", async () => {
  let calls = 0;
  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "/post P001",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async () => { calls += 1; },
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test("shows public order-status and support buttons on start", async () => {
  const calls = [];
  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "/start",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    { ...env, TELEGRAM_ADMIN_USER_ID: "" },
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  const cleanupBody = JSON.parse(calls[0].options.body);
  assert.equal(cleanupBody.reply_markup.remove_keyboard, true);
  const sentBody = JSON.parse(calls[1].options.body);
  const menuBody = sentBody;
  const [orderButton, supportButton] = menuBody.reply_markup.inline_keyboard[0];
  assert.deepEqual(orderButton, {
    text: "📦 پیگیری سفارش",
    callback_data: "order",
  });
  assert.deepEqual(supportButton, {
    text: "💬 ارتباط با ادمین",
    url: "https://t.me/khoshmazeforoshi_supp",
  });
  assert.equal(
    sentBody.text,
    "سلام. به ربات خوشمزه فروشی خوش آمدید.\nچه کمکی میتونم بهتون بکنم؟",
  );
  assert.doesNotMatch(sentBody.text, /فرمان‌های مدیریت/);
  assert.match(calls[2].url, /\/deleteMessage$/);
});

test("public order callback starts lookup without admin access", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      callback_query: {
        id: "public-order-callback",
        data: "order",
        from: { id: 99 },
        message: { message_id: 8, chat: { id: 99, type: "private" } },
      },
    }),
    { ...env, TELEGRAM_ADMIN_USER_ID: "" },
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/answerCallbackQuery$/);
  assert.match(calls[1].url, /\/sendMessage$/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.text, ORDER_ID_PROMPT);
  assert.equal(body.reply_markup.force_reply, true);
});

test("shows the exact start message to the admin without extra command text", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "/start",
        from: { id: 42 },
        chat: { id: 42, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  const body = JSON.parse(calls[1].options.body);
  assert.equal(
    body.text,
    "سلام. به ربات خوشمزه فروشی خوش آمدید.\nچه کمکی میتونم بهتون بکنم؟",
  );
});

test("order button requests the order ID with Telegram UI", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "📦 پیگیری سفارش",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text, ORDER_ID_PROMPT);
  assert.doesNotMatch(body.text, /مثال/);
  assert.equal(body.reply_markup.input_field_placeholder, "شماره سفارش");
  assert.equal(body.reply_markup.force_reply, true);
});

test("shows the exact invalid order ID text without an example", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "اشتباه",
        reply_to_message: { text: ORDER_ID_PROMPT },
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text, "شماره سفارش وارد شده اشتباه است");
  assert.doesNotMatch(body.text, /مثال/);
  assert.equal(body.reply_markup.force_reply, true);
});

test("order ID reply requests the exact billing mobile number", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "۱۲۳۴۵",
        reply_to_message: { text: ORDER_ID_PROMPT },
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text, ORDER_PHONE_PROMPT);
  assert.doesNotMatch(body.text, /توجه|مثال|12345/);
  assert.equal(body.entities[0].url, "https://t.me/#khosh-order-12345");
  assert.equal(body.reply_markup.force_reply, true);
});

test("matching order ID and billing phone returns the Persian status", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/wp-json/wc/v3/orders/12345")) {
      return jsonResponse({
        id: 12345,
        status: "processing",
        billing: { phone: "+98 912 345 6789" },
      });
    }
    return telegramSuccess();
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "۰۹۱۲۳۴۵۶۷۸۹",
        reply_to_message: phonePromptReply("12345"),
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  const wooCall = calls.find((call) => call.url.includes("/wp-json/wc/v3/orders/12345"));
  assert.ok(wooCall);
  assert.equal(wooCall.options.method, "GET");
  assert.equal(wooCall.options.redirect, "manual");
  assert.match(wooCall.options.headers.Authorization, /^Basic /);
  assert.doesNotMatch(wooCall.url, /consumer_(key|secret)/);
  const expectedText = "وضعیت سفارش #12345: در حال پردازش";
  const body = sentTelegramBody(calls, expectedText);
  assert.equal(body.text, expectedText);
});

test("does not follow WooCommerce redirects with the authorization header", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/wp-json/wc/v3/orders/12345")) {
      return new Response(null, {
        status: 301,
        headers: { Location: "https://other.example/orders/12345" },
      });
    }
    return telegramSuccess();
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "09123456789",
        reply_to_message: phonePromptReply("12345"),
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  const wooCalls = calls.filter((call) => call.url.includes("/wp-json/wc/v3/orders/"));
  assert.equal(wooCalls.length, 1);
  assert.equal(wooCalls[0].options.redirect, "manual");
  const expectedText = "سرویس پیگیری سفارش موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.";
  const body = sentTelegramBody(calls, expectedText);
  assert.equal(body.text, expectedText);
});

test("wrong billing phone uses the same generic not-found response", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/wp-json/wc/v3/orders/12345")) {
      return jsonResponse({
        id: 12345,
        status: "completed",
        billing: { phone: "09120000000" },
      });
    }
    return telegramSuccess();
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "09123456789",
        reply_to_message: phonePromptReply("12345"),
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  const expectedText = "سفارش با این مشخصات یافت نشد";
  const body = sentTelegramBody(calls, expectedText);
  assert.equal(body.text, expectedText);
});

test("invalid mobile input keeps the user in the phone step", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "123",
        reply_to_message: phonePromptReply("12345"),
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text, INVALID_ORDER_PHONE_TEXT);
  assert.equal(body.entities[0].url, "https://t.me/#khosh-order-12345");
  assert.equal(body.reply_markup.force_reply, true);
});

test("valid phone can continue after the invalid-phone message", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/wp-json/wc/v3/orders/12345")) {
      return jsonResponse({
        id: 12345,
        status: "completed",
        billing: { phone: "09123456789" },
      });
    }
    return telegramSuccess();
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "09123456789",
        reply_to_message: phonePromptReply("12345", INVALID_ORDER_PHONE_TEXT),
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  const expectedText = "وضعیت سفارش #12345: تکمیل شده";
  const body = sentTelegramBody(calls, expectedText);
  assert.equal(body.text, expectedText);
});

test("ignores public order lookup in group chats", async () => {
  let calls = 0;
  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "📦 پیگیری سفارش",
        from: { id: 99 },
        chat: { id: -100, type: "supergroup" },
      },
    }),
    env,
    async () => { calls += 1; },
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test("shows confirmation buttons for an admin post command", async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return telegramSuccess();
  };

  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "/post P001",
        from: { id: 42 },
        chat: { id: 42, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data, "post:P001");
});

test("confirmed callback dispatches GitHub workflow with product and chat IDs", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("api.github.com")) return new Response(null, { status: 204 });
    return telegramSuccess();
  };

  const response = await handleRequest(
    webhookRequest({
      callback_query: {
        id: "callback-1",
        data: "post:P001",
        from: { id: 42 },
        message: { message_id: 7, chat: { id: 42, type: "private" } },
      },
    }),
    env,
    fetchMock,
  );

  assert.equal(response.status, 200);
  const githubCall = calls.find((call) => call.url.includes("api.github.com"));
  assert.ok(githubCall);
  const body = JSON.parse(githubCall.options.body);
  assert.deepEqual(body.inputs, { product_id: "P001", request_chat_id: "42" });
  const editedMessage = calls.find((call) => call.url.includes("/editMessageText"));
  assert.ok(editedMessage);
});

test("rejects a Bale webhook with the wrong path secret", async () => {
  let calls = 0;
  const response = await handleRequest(
    baleWebhookRequest({}, "wrong-secret"),
    { ...env, ORDER_SESSIONS: new MemoryKv() },
    async () => { calls += 1; },
  );

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("shows public order-status and support buttons on Bale start", async () => {
  const calls = [];
  const response = await handleRequest(
    baleWebhookRequest({
      message: {
        text: "/start",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    { ...env, ORDER_SESSIONS: new MemoryKv() },
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/tapi\.bale\.ai\/botbale-token\/sendMessage$/);
  const body = JSON.parse(calls[0].options.body);
  const [orderButton, supportButton] = body.reply_markup.inline_keyboard[0];
  assert.deepEqual(orderButton, {
    text: "📦 پیگیری سفارش",
    callback_data: "order",
  });
  assert.deepEqual(supportButton, {
    text: "💬 ارتباط با ادمین",
    url: "https://ble.ir/khoshmazeforoshi_supp",
  });
  assert.equal(
    body.text,
    "سلام. به ربات خوشمزه فروشی خوش آمدید.\nچه کمکی میتونم بهتون بکنم؟",
  );
});

test("Bale order callback stores the conversation step and requests the order ID", async () => {
  const calls = [];
  const sessions = new MemoryKv();
  await handleRequest(
    baleWebhookRequest({
      callback_query: {
        id: "bale-order-callback",
        data: "order",
        from: { id: 99 },
        message: { message_id: 8, chat: { id: 99, type: "private" } },
      },
    }),
    { ...env, ORDER_SESSIONS: sessions },
    async (url, options) => {
      calls.push({ url, options });
      return telegramSuccess();
    },
  );

  assert.equal(await sessions.get("bale:awaiting_order:99"), "1");
  assert.match(calls[0].url, /\/answerCallbackQuery$/);
  assert.equal(JSON.parse(calls[1].options.body).text, ORDER_ID_PROMPT);
});

test("Bale order lookup collects order ID and phone and returns the Persian status", async () => {
  const calls = [];
  const sessions = new MemoryKv();
  const baleEnv = { ...env, ORDER_SESSIONS: sessions };
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/wp-json/wc/v3/orders/12345")) {
      return jsonResponse({
        id: 12345,
        status: "completed",
        billing: { phone: "09123456789" },
      });
    }
    return telegramSuccess();
  };

  await sessions.put("bale:awaiting_order:99", "1");
  await handleRequest(
    baleWebhookRequest({
      message: {
        text: "۱۲۳۴۵",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    baleEnv,
    fetchMock,
  );

  assert.equal(await sessions.get("bale:awaiting_order:99"), null);
  assert.equal(await sessions.get("bale:awaiting_phone:99"), "12345");
  const phonePromptCall = calls.find((call) => {
    if (!call.url.endsWith("/sendMessage")) return false;
    return JSON.parse(call.options.body).text === ORDER_PHONE_PROMPT;
  });
  assert.ok(phonePromptCall);

  await handleRequest(
    baleWebhookRequest({
      message: {
        text: "۰۹۱۲۳۴۵۶۷۸۹",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    baleEnv,
    fetchMock,
  );

  assert.equal(await sessions.get("bale:awaiting_phone:99"), null);
  const wooCall = calls.find((call) => call.url.includes("/wp-json/wc/v3/orders/12345"));
  assert.ok(wooCall);
  assert.equal(wooCall.options.redirect, "manual");
  const statusCall = calls.find((call) => {
    if (!call.url.endsWith("/sendMessage")) return false;
    return JSON.parse(call.options.body).text === "وضعیت سفارش #12345: تکمیل شده";
  });
  assert.ok(statusCall);
  const statusBody = JSON.parse(statusCall.options.body);
  assert.equal(statusBody.reply_markup.inline_keyboard[0][1].url, "https://ble.ir/khoshmazeforoshi_supp");
});
