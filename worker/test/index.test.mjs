import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

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

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

test("shows a public order-status button on start", async () => {
  const calls = [];
  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "/start",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, result: {} });
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.reply_markup.keyboard[0][0].text, "📦 پیگیری وضعیت سفارش");
  assert.doesNotMatch(body.text, /فرمان‌های مدیریت/);
});

test("order button requests the order ID with Telegram UI", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "📦 پیگیری وضعیت سفارش",
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, result: {} });
    },
  );

  const body = JSON.parse(calls[0].options.body);
  assert.match(body.text, /شماره سفارش/);
  assert.equal(body.reply_markup.force_reply, true);
});

test("order ID reply requests the exact billing mobile number", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "۱۲۳۴۵",
        reply_to_message: { text: "لطفاً شماره سفارش را وارد کنید.\nمثال: 12345" },
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, result: {} });
    },
  );

  const body = JSON.parse(calls[0].options.body);
  assert.match(body.text, /سفارش #12345/);
  assert.match(body.text, /شماره موبایلی که.*ثبت شده/);
  assert.match(body.text, /ممکن است این شماره با شماره شخصی شما متفاوت باشد/);
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
    return jsonResponse({ ok: true, result: {} });
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "۰۹۱۲۳۴۵۶۷۸۹",
        reply_to_message: {
          text: "شماره موبایلی که سفارش #12345 با آن ثبت شده است را وارد کنید.\nتوجه: ممکن است این شماره با شماره شخصی شما متفاوت باشد.",
        },
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
  assert.match(wooCall.options.headers.Authorization, /^Basic /);
  assert.doesNotMatch(wooCall.url, /consumer_(key|secret)/);
  const telegramCall = calls.find((call) => call.url.includes("/sendMessage"));
  const body = JSON.parse(telegramCall.options.body);
  assert.equal(body.text, "وضعیت سفارش #12345: در حال پردازش");
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
    return jsonResponse({ ok: true, result: {} });
  };

  await handleRequest(
    webhookRequest({
      message: {
        text: "09123456789",
        reply_to_message: {
          text: "شماره موبایلی که سفارش #12345 با آن ثبت شده است را وارد کنید.",
        },
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    fetchMock,
  );

  const telegramCall = calls.find((call) => call.url.includes("/sendMessage"));
  const body = JSON.parse(telegramCall.options.body);
  assert.equal(body.text, "سفارش پیدا نشد یا شماره موبایل با سفارش مطابقت ندارد.");
});

test("invalid mobile input keeps the user in the phone step", async () => {
  const calls = [];
  await handleRequest(
    webhookRequest({
      message: {
        text: "123",
        reply_to_message: {
          text: "شماره موبایل معتبر نیست.\n\nشماره موبایلی که سفارش #12345 با آن ثبت شده است را وارد کنید.",
        },
        from: { id: 99 },
        chat: { id: 99, type: "private" },
      },
    }),
    env,
    async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, result: {} });
    },
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.text, /شماره موبایل معتبر نیست/);
  assert.match(body.text, /سفارش #12345/);
  assert.equal(body.reply_markup.force_reply, true);
});

test("ignores public order lookup in group chats", async () => {
  let calls = 0;
  const response = await handleRequest(
    webhookRequest({
      message: {
        text: "📦 پیگیری وضعیت سفارش",
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
    return jsonResponse({ ok: true, result: {} });
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
    return jsonResponse({ ok: true, result: {} });
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
