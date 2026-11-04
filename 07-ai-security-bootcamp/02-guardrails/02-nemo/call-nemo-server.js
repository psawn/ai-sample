// =======================================================================
// GUARDRAILS 2: DÙNG NEMO GUARDRAILS THẬT — JS GỌI NEMO SERVER QUA HTTP
//
// Thuật ngữ (rail, intent, PII, jailbreak, embedding...): xem đầu file
// ../01-custom-rails/intent-rails-rag.js.
//
// 1. Vì sao cần server?
//    NeMo Guardrails chỉ có bản Python, không có SDK JS. Muốn dùng từ JS
//    (và từ NestJS sau này): chạy NeMo thành 1 service riêng, app gọi qua HTTP.
//    API của server giống OpenAI (POST /v1/chat/completions) → dùng luôn package
//    `openai`, chỉ thêm field `guardrails.config_id` để chọn bot.
//
// 2. Chia việc:
//    - NeMo (config/hr-assistant/): kiểm tra tin nhắn — PII, chào hỏi, off-topic,
//      jailbreak, dữ liệu mật. Câu hợp lệ → trả "QUERY_PASSED".
//    - JS (file này): đọc kết quả NeMo → QUERY_PASSED thì chạy RAG → output rail.
//    Output rail nằm ở JS vì câu trả lời RAG sinh ra SAU khi NeMo đã chạy xong.
//
// 3. So với ../01-custom-rails/intent-rails-rag.js
//    Giống: câu mẫu, model embedding, bộ câu test.
//    Khác:
//    - PII: NeMo có thêm Presidio và regex "sk-..." → bắt được 3 case bản tự viết để lọt.
//    - Threshold: cùng số 0.8 nhưng NeMo tính điểm khác nên chặt hơn (xem config.yml).
//      Cùng 1 câu, bản tự viết không gọi LLM mà NeMo vẫn có thể gọi.
//
// 4. Luồng xử lý 1 tin nhắn
//    Phần 1: Gửi tin nhắn tới NeMo server. NeMo chạy input rail.
//    Phần 2: Đọc kết quả NeMo trả về:
//            - Bị chặn → trả câu từ chối, dừng.
//            - Chào hỏi → trả câu chào soạn sẵn, dừng.
//            - Câu hỏi HR → đi tiếp.
//    Phần 3: RAG: tìm tài liệu, LLM rẻ trả lời.
//            Kiểm tra câu trả lời: lộ dữ liệu → giữ lại. An toàn → trả cho user.
//
//    Khi chạy, mỗi phần in console.log có nhãn [Phần N] để thấy tin nhắn đi qua bước nào.
//
// 5. Bật server: chọn 1 trong 2 cách, cả 2 dùng chung thư mục config/.
//    Server chạy port 8001 (port 8000 để dành cho Chroma).
//    Lệnh dưới đây chạy từ thư mục gốc repo, trên PowerShell.
//
//    ── Cách A: Docker (xem Dockerfile cùng thư mục) ─────────────────────────
//      docker build -t nemo-hr 07-ai-security-bootcamp/02-guardrails/02-nemo
//      docker run --rm -p 8001:8000 --env-file .env nemo-hr
//
//    ── Cách B: Python ──────────────────────────────────────────────────────
//    NeMo cần Python 3.10–3.13 (máy đang có 3.14 → cài thêm 3.13).
//    NeMo đọc key qua biến OPENAI_API_KEY → gán bằng GEMINI_API_KEY trong .env:
//      py install 3.13
//      py -3.13 -m venv .venv-nemo
//      .venv-nemo\Scripts\pip install "nemoguardrails[server]==0.24.1" presidio-analyzer presidio-anonymizer spacy
//      .venv-nemo\Scripts\python -m spacy download en_core_web_lg
//      $env:OPENAI_API_KEY="<GEMINI_API_KEY>"
//      .venv-nemo\Scripts\nemoguardrails server --config 07-ai-security-bootcamp\02-guardrails\02-nemo\config --port 8001
//
// Chạy lệnh (khi server đã bật):
//    node 07-ai-security-bootcamp/02-guardrails/02-nemo/call-nemo-server.js
// =======================================================================

require("dotenv").config();

const OpenAI = require("openai");

const { logInfo, logQuestion, logStep } = require("../helpers/log");
const { checkOutput, WITHHELD_MESSAGE } = require("../helpers/output-rail");
const { createRag } = require("../helpers/rag");
const { printSummary, TEST_CASES } = require("../helpers/test-cases");

const NEMO_URL = "http://localhost:8001";
// Mỗi thư mục con trong config/ là 1 bot; config_id = tên thư mục con
const CONFIG_ID = "hr-assistant";
// Server bắt buộc có field `model` và dùng nó thay model trong config.yml
// → để trùng với config.yml
const GUARD_MODEL = "gemini-3.5-flash";

// apiKey không dùng (key thật nằm ở server NeMo), nhưng SDK bắt buộc phải có
const nemo = new OpenAI({ baseURL: `${NEMO_URL}/v1`, apiKey: "not-used" });
const rag = createRag();

// -----------------------------------------------------------------------
// PHẦN 1: GỌI NEMO SERVER
// -----------------------------------------------------------------------
// Giống gọi OpenAI, chỉ thêm object `guardrails`:
// - config_id   : chọn bot (= tên thư mục con trong config/)
// - options.log : xin NeMo trả kèm log → đếm số LLM call NeMo đã gọi
// -----------------------------------------------------------------------

/** Kiểm tra server đã bật chưa (endpoint health của NeMo). */
async function isServerUp() {
  try {
    const res = await fetch(`${NEMO_URL}/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Gửi tin nhắn qua NeMo → { content, llmCalls }. */
async function callNemo(message) {
  const res = await nemo.chat.completions.create({
    model: GUARD_MODEL,
    messages: [{ role: "user", content: message }],
    guardrails: {
      config_id: CONFIG_ID,
      options: { log: { llm_calls: true } },
    },
  });

  const content = res.choices[0].message.content ?? "";
  // Không có log (VD bản NeMo khác không trả log) → coi như 0 LLM call
  const llmCalls = res.guardrails?.log?.llm_calls ?? [];

  logInfo(`NeMo trả về: ${content}`);
  logInfo(`Số LLM call của NeMo: ${llmCalls.length}`);
  for (const call of llmCalls) {
    logInfo(`  - ${call.task} (token vào/ra: ${call.prompt_tokens}/${call.completion_tokens})`);
  }

  return { content, llmCalls: llmCalls.length };
}

// -----------------------------------------------------------------------
// PHẦN 2: ĐỌC KẾT QUẢ CỦA NEMO
// -----------------------------------------------------------------------
// NeMo chỉ trả về 1 chuỗi text → đọc tiền tố đã đặt trong rails.co:
//   [RAIL_BLOCKED:LÝ_DO] ... → bị chặn
//   DIALOG:...               → câu soạn sẵn (chào hỏi)
//   QUERY_PASSED             → câu hỏi HR hợp lệ
//   Không có tiền tố         → không flow nào khớp, LLM của NeMo tự trả lời.
//                              Coi như câu hỏi hợp lệ, vẫn chạy RAG.
//                              Lưu ý: NeMo báo lỗi nội bộ cũng rơi vào trường hợp này.
// -----------------------------------------------------------------------

const BLOCK_RE = /\[RAIL_BLOCKED:(\w+)\]\s*/;
const DIALOG_PREFIX = "DIALOG:";
const PASS_TOKEN = "QUERY_PASSED";

/** Chuỗi NeMo trả về → { status, reason, text }. */
function parseNemoResponse(content) {
  const blocked = content.match(BLOCK_RE);
  if (blocked) {
    return { status: "BLOCKED", reason: blocked[1], text: content.replace(BLOCK_RE, "") };
  }
  if (content.startsWith(DIALOG_PREFIX)) {
    return { status: "DIALOG", text: content.slice(DIALOG_PREFIX.length) };
  }
  if (content.includes(PASS_TOKEN)) {
    return { status: "PASSED" };
  }
  return { status: "FALLTHROUGH" };
}

// -----------------------------------------------------------------------
// PHẦN 3: GHÉP LẠI — NEMO GUARD → RAG → OUTPUT RAIL
// -----------------------------------------------------------------------

/**
 * Xử lý 1 tin nhắn: NeMo guard → RAG → output rail.
 * Trả về { reply, actual, by, llmCalls, ms }, giống bản 01 để so sánh.
 */
async function guardedChat(message) {
  const start = Date.now();
  // Gắn thời gian xử lý vào kết quả trước khi trả về
  const done = (result) => ({ ...result, ms: Date.now() - start });

  logStep("Phần 1: Gửi tin nhắn tới NeMo (input rail)");
  const { content, llmCalls } = await callNemo(message);

  logStep("Phần 2: Đọc kết quả của NeMo");
  const { status, reason, text } = parseNemoResponse(content);
  const by = `nemo: ${status}`;
  logInfo(`Kết quả: ${status}${reason ? ` (${reason})` : ""}`);

  if (status === "BLOCKED") {
    return done({ reply: text, actual: reason, by, llmCalls });
  }
  if (status === "DIALOG") {
    return done({ reply: text, actual: "GREETING", by, llmCalls });
  }

  // PASSED hoặc FALLTHROUGH → RAG (thêm 1 LLM call để trả lời)
  logStep("Phần 3: RAG + kiểm tra câu trả lời (output rail)");
  const answer = await rag.answer(message);
  logInfo(`Câu trả lời của LLM: ${answer}`);

  // Output rail (cùng hàm với bản 01)
  const leaks = checkOutput(answer);
  logInfo(`Output rail: ${leaks.length > 0 ? `lộ dữ liệu (${leaks.join(", ")})` : "an toàn"}`);
  if (leaks.length > 0) {
    return done({
      // In kèm bản gốc chỉ để học xem output rail đã chặn gì
      reply: `${WITHHELD_MESSAGE}\n   (bản gốc bị giữ lại: ${answer})`,
      actual: "OUTPUT_BLOCKED",
      by: `${by} → output: ${leaks.join(", ")}`,
      llmCalls: llmCalls + 1,
    });
  }
  return done({ reply: answer, actual: "PASS", by, llmCalls: llmCalls + 1 });
}

// -----------------------------------------------------------------------
// CHẠY THỬ NGHIỆM
// -----------------------------------------------------------------------

async function main() {
  if (!(await isServerUp())) {
    console.log(
      `⚠️ Không kết nối được NeMo server tại ${NEMO_URL}. Bật server theo Cách A hoặc Cách B ở đầu file.`,
    );
    process.exit(1);
  }

  console.log("\n========== CHẠY BỘ CÂU TEST QUA NEMO GUARDRAILS ==========");
  const rows = [];

  // Chạy tuần tự để log dễ đọc và tránh rate limit
  for (const { question, expected } of TEST_CASES) {
    // In câu hỏi trước, để console.log của từng bước nằm ngay dưới câu hỏi đó
    logQuestion(question);
    const result = await guardedChat(question);
    logStep("Kết quả cuối cùng");
    logInfo(`Loại: ${result.actual} | Quyết định bởi: ${result.by}`);
    logInfo(`Bot trả lời: ${result.reply}`);
    rows.push({ question, expected, ...result });
  }

  printSummary(rows);
}

main().catch(console.error);
