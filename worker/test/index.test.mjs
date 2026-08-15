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

test("ignores commands from non-admin users", async () => {
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
