import test from "node:test";
import assert from "node:assert/strict";
import { readRequest } from "../src/services/readRequest.js";
import { describeConnectionIssue } from "../src/utils/connectionIssue.js";
import { readPeriodRows } from "../../shared/periods.js";

test("temporary network failure retries once and returns recovered data", async () => {
  let calls = 0;
  const data = await readRequest("读取征集期", () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return { data: [{ id: "period" }] };
  }, { retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(data, [{ id: "period" }]);
});

test("timeout aborts both attempts and reports the operation, even if request never settles", async () => {
  const signals = [];
  await assert.rejects(readRequest("读取个人喜欢记录", (signal) => {
    signals.push(signal);
    return new Promise(() => {});
  }, { timeoutMs: 10, retryDelayMs: 0 }), (error) => {
    assert.equal(error.code, "CLIENT_TIMEOUT");
    assert.equal(error.operation, "读取个人喜欢记录");
    return true;
  });
  assert.equal(signals.length, 2);
  assert(signals.every((signal) => signal.aborted));
});

test("permission, schema and rate errors are not retried, HTTP status survives", async () => {
  for (const [status, code] of [[403, "42501"], [400, "42703"], [429, ""]]) {
    let calls = 0;
    await assert.rejects(readRequest("读取歌单", () => {
      calls += 1;
      return { error: { code, message: "denied" }, status };
    }), (error) => error.status === status && error.code === code);
    assert.equal(calls, 1);
  }
});

test("server errors retry once, permanent failures retain diagnosis", async () => {
  let calls = 0;
  await assert.rejects(readRequest("读取歌单", () => {
    calls += 1;
    return { error: { message: "Service unavailable" }, status: 503 };
  }, { retryDelayMs: 0 }), (error) => error.status === 503 && error.operation === "读取歌单");
  assert.equal(calls, 2);
});

test("diagnosis distinguishes offline, timeout, network and service errors without guessing a definite network cause", () => {
  assert.equal(describeConnectionIssue({}, { offline: true }).label, "网络未连接");
  assert.equal(describeConnectionIssue({ code: "CLIENT_TIMEOUT" }).label, "连接超时");
  const network = describeConnectionIssue({ message: "TypeError: Failed to fetch" });
  assert.equal(network.label, "服务连接失败");
  assert.match(network.advice, /未提供确切原因/);
  assert.equal(network.code, "NETWORK");
  assert.equal(describeConnectionIssue({ status: 503 }).label, "服务暂不可用");
  assert.equal(describeConnectionIssue({ status: 401 }).label, "验证失败");
  assert.equal(describeConnectionIssue({ code: "42501" }).label, "访问受限");
  assert.equal(describeConnectionIssue({ status: 429 }).label, "请求过多");
  assert.match(describeConnectionIssue({ code: "42703" }).message, /数据库配置异常/);
});

test("visible diagnosis never exposes raw server details or credentials", () => {
  const issue = describeConnectionIssue({ message: "SECRET_TOKEN", details: "visitor-id", code: "UNKNOWN" });
  assert.doesNotMatch(JSON.stringify(issue), /SECRET_TOKEN|visitor-id/);
});

test("legacy period fallback keeps abort signal and only permits missing is_test", async () => {
  const calls = [];
  let code = "42703";
  const client = { from() {
    let columns;
    const query = {
      select(value) { columns = value; return this; },
      order() { return this; }, limit() { return this; },
      abortSignal(signal) {
        calls.push({ columns, signal });
        return Promise.resolve(columns.endsWith(",is_test")
          ? { error: { code, message: "column is_test does not exist" }, status: 400 }
          : { data: [{ id: "old-period" }] });
      },
    };
    return query;
  } };
  const signal = new AbortController().signal;
  assert.deepEqual(await readPeriodRows(client, { signal }), [{ id: "old-period" }]);
  assert.equal(calls.length, 2);
  assert(calls.every((call) => call.signal === signal));
  code = "42501";
  await assert.rejects(readPeriodRows(client, { signal }), (error) => error.code === "42501" && error.status === 400);
  assert.equal(calls.length, 3);
});
