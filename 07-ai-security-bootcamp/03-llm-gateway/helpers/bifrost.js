// =======================================================================
// LLM GATEWAY - HELPER GỌI BIFROST
//
// Client OpenAI trỏ vào Bifrost, hàm gửi request, hàm in kết quả, model dùng chung.
//
// Gọi Bifrost từ code:
//   - Bifrost dùng định dạng API của OpenAI → dùng package `openai`, đổi `baseURL` sang gateway.
//   - Tên model: `provider/model`. VD `gemini/gemini-3.5-flash`.
//   - Mọi request phải gửi virtual key trong header `x-bf-vk`, thiếu thì lỗi 401.
//
// Đổi sang Groq (có gói free):
//   - Code: dùng 2 dòng PRIMARY_MODEL, FALLBACK_MODEL của Groq (đang comment) bên dưới.
//   - bifrost-config.json: đổi model trong routing rule `config-fallback-demo` (fallbacks),
//     `load-balance-demo` (targets) → restart gateway. `session-affinity-demo` đã có sẵn Groq.
//   - Các chỗ vẫn dùng Gemini:
//     + Baseline trong 01-gateway-basics.js: gọi bằng SDK của Google.
//     + Budget trong 05-budget-and-prompt.js: bài học là Gemini hết tiền → chuyển sang Groq.
//     + MCP trong 06-mcp.js: virtual key MCP chỉ cho dùng Gemini.
//     + Embedding của semantic cache: Groq không có model embedding.
//   - Groq free giới hạn số request, token mỗi phút → chạy nhiều phần liền nhau có thể bị lỗi 429.
//
// Các file đang sử dụng:
//   - ../01-gateway-basics.js
//   - ../02-retry-fallback-routing.js
//   - ../03-cache-and-full-setup.js
//   - ../04-framework-integration.js
//   - ../05-budget-and-prompt.js
//   - ../06-mcp.js
// =======================================================================

require("dotenv").config();

const OpenAI = require("openai");

const { logInfo } = require("../../helpers/log");

const BIFROST_URL = "http://localhost:8090";
const PRIMARY_MODEL = "gemini/gemini-3.5-flash"; // model chính
const FALLBACK_MODEL = "gemini/gemini-3.5-flash-lite"; // model dự phòng
// const PRIMARY_MODEL = "groq/openai/gpt-oss-120b";
// const FALLBACK_MODEL = "groq/openai/gpt-oss-20b";

const bifrostClient = new OpenAI({
  // baseURL: endpoint định dạng OpenAI của Bifrost, nhận thêm `fallbacks`
  baseURL: `${BIFROST_URL}/v1`,
  // apiKey: SDK bắt buộc có nên điền tạm. Key thật nằm ở gateway.
  apiKey: "not-used",
  // defaultHeaders: gửi virtual key kèm mọi request, thiếu thì lỗi 401
  defaultHeaders: { "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY },
  // maxRetries: tắt retry của SDK, tránh retry chồng lên gateway
  maxRetries: 0,
});

/** Chờ `ms` mili giây. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gửi 1 request qua Bifrost, trả về câu trả lời và thông tin từ gateway.
 *
 * - `body`: body của OpenAI, thêm được `fallbacks`.
 * - `headers`: header của Bifrost (cache key, metadata...).
 *   Gửi `x-bf-vk` ở đây → dùng virtual key khác thay key mặc định.
 * - `.withResponse()`: lấy thêm response gốc để đọc header `x-bifrost-*`:
 *   + `servedModel`: model thật đã trả lời. Có thể khác model trong request (do fallback, routing rule).
 *   + `usedFallback`: có phải model dự phòng trả lời không.
 *   + `fromCache`: lấy từ cache hay gọi model thật.
 */
async function chatViaBifrost(body, headers = {}) {
  const startedAt = Date.now();
  const { data, response } = await bifrostClient.chat.completions
    .create(body, { headers })
    .withResponse();

  return {
    answer: data.choices[0].message.content,
    latencyMs: Date.now() - startedAt,
    servedModel:
      response.headers.get("x-bifrost-routing-info-model") ?? data.model,
    usedFallback:
      response.headers.get("x-bifrost-routing-info-is-fallback") === "true",
    fromCache: response.headers.get("x-bifrost-cache-hit") === "true",
  };
}

/** In câu trả lời (cắt ngắn) và thời gian chạy. */
function logAnswer(answer, latencyMs, note = "") {
  const shortAnswer =
    answer.length > 200 ? `${answer.slice(0, 200)}...` : answer;
  logInfo(`Trả lời: ${shortAnswer.replace(/\s+/g, " ")}`);
  logInfo(`⏱  ${latencyMs}ms${note ? ` | ${note}` : ""}`);
}

/**
 * Chạy `main` của 1 bài: kiểm tra .env trước, rồi báo lỗi dễ hiểu nếu có.
 *
 * - `requiredEnv`: biến .env bài cần. Thiếu → báo ngay, không gọi gateway.
 * - Không kết nối được gateway → nhắc cách bật, thay vì in lỗi mạng khó hiểu.
 */
function runLesson(main, requiredEnv = ["BIFROST_VIRTUAL_KEY"]) {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(
      `Chưa có ${missing.join(", ")} trong .env (xem phần Chuẩn bị trong 01-gateway-basics.js).`,
    );
    process.exitCode = 1;
    return;
  }

  main().catch((error) => {
    if (error instanceof OpenAI.APIConnectionError) {
      console.error(
        `Không kết nối được Bifrost ở ${BIFROST_URL}: bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js.`,
      );
    } else {
      console.error(`${error.name}: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  BIFROST_URL,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  bifrostClient,
  sleep,
  chatViaBifrost,
  logAnswer,
  runLesson,
};
