require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 5: BIFROST — BUDGET VÀ PROMPT Ở GATEWAY
//
// Mục đích: quản lý ở gateway, không sửa code app:
//   - Budget: giới hạn tiền theo virtual key, hết tiền thì chặn hoặc chuyển provider.
//   - Prompt: system prompt lưu ở gateway, có version, app chỉ gửi câu hỏi.
//
// 1. Config dùng trong file này (bifrost-config.json):
//    - `vk-budget-demo` (BIFROST_BUDGET_VK): virtual key riêng cho Phần 1. Dùng được Gemini và Groq.
//      + Cả 2 `weight: 1` nhưng không chia 50/50, vì Phần 1 luôn nói rõ provider.
//      + Tách key riêng → chỉ Phần 1 bị kiểm tra budget, các bài khác không ảnh hưởng.
//    - governance.budgets + model_configs: Gemini trong `vk-budget-demo` chỉ được $0.0001/giờ.
//      + Đặt ở model_configs (chỉ Gemini), không đặt ở cả key → Groq không bị chặn theo.
//      + Xem ở trang Budgets & Limits. Trang Virtual Keys cũng có, ở mục Provider Budgets của Gemini,
//        nhưng hạn mức quá nhỏ nên hiện `$0.00 / $0.00`.
//
// 2. Luồng file:
//    - Phần 1: Budget — hết tiền thì chặn hoặc chuyển provider
//    - Phần 2: Prompt ở gateway — app chỉ gửi câu hỏi
//
// 3. Chuẩn bị:
//    - Bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js.
//    - Tạo prompt cho Phần 2 (chỉ tạo được trên UI, config không khai báo được):
//      + Trang Prompt Repository → New Prompt → thêm System message:
//        "Bạn là chuyên gia IT doanh nghiệp. Trả lời đúng 1 câu tiếng Việt, bắt đầu bằng 💡."
//        → Commit Version (thành v1).
//      + Gõ thẳng vào System message để sửa (không cần bấm bút chì) thành
//        "... Trả lời đúng 3 gạch đầu dòng." → Commit Version (thành v2).
//      + ID prompt nằm trên URL khi mở prompt: ...?promptId=<ID>. Copy vào .env: BIFROST_PROMPT_ID=...
//      + Prompt lưu trong database → `docker compose down -v` là mất.
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/05-budget-and-prompt.js
// =======================================================================

require("dotenv").config();

const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  PRIMARY_MODEL,
  chatViaBifrost,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

// Phần 1: budget chỉ giới hạn Gemini → luôn dùng Gemini, không theo PRIMARY_MODEL
const BUDGET_GEMINI_MODEL = "gemini/gemini-3.5-flash";
const GROQ_MODEL = "groq/openai/gpt-oss-20b"; // Phần 1: Gemini hết tiền thì chuyển sang model này

// =======================================================================
// PHẦN 1: BUDGET — HẾT TIỀN THÌ CHẶN HOẶC CHUYỂN PROVIDER
// =======================================================================

/**
 * Gửi request bằng virtual key demo (BIFROST_BUDGET_VK): Gemini chỉ được $0.0001/giờ.
 *
 * - Bước 1: gửi Gemini 3 lần, không có `fallbacks`.
 *   1 request tốn khoảng $0.004 > budget $0.0001 → lần 1 qua nhưng đã vượt budget,
 *   lần 2–3 bị chặn: lỗi 402, type `budget_exceeded`.
 * - Bước 2: gửi Gemini kèm `fallbacks` Groq → gateway gửi sang Groq, app vẫn có câu trả lời.
 * - Budget reset sau 1 giờ. Chạy lại trong 1 giờ thì lần 1 cũng bị chặn.
 */
async function budgetLimits() {
  logStep("Phần 1: Budget — hết tiền thì chặn hoặc chuyển provider");

  if (!process.env.BIFROST_BUDGET_VK) {
    logInfo(
      "Chưa có BIFROST_BUDGET_VK trong .env (xem phần Chuẩn bị trong 01-gateway-basics.js).",
    );
    return;
  }
  // Gửi key demo thay key mặc định → request bị kiểm tra theo budget của key demo
  const budgetHeaders = { "x-bf-vk": process.env.BIFROST_BUDGET_VK };
  const question = "Kubernetes Service là gì? Trả lời 1 câu.";
  const messages = [{ role: "user", content: question }];

  // Bước 1: không có fallbacks → Gemini hết tiền thì bị chặn
  for (let attempt = 1; attempt <= 3; attempt++) {
    logQuestion(`[Không fallback, lần ${attempt}] ${question}`);
    try {
      const result = await chatViaBifrost(
        { model: BUDGET_GEMINI_MODEL, messages },
        budgetHeaders,
      );
      logAnswer(
        result.answer,
        result.latencyMs,
        `model: ${result.servedModel}`,
      );
    } catch (error) {
      logInfo(`❌ Bị chặn: ${error.message}`); // message đã có mã lỗi, VD "402 Budget exceeded..."
    }
  }

  // Bước 2: có fallbacks Groq → Gemini hết tiền thì chuyển sang Groq
  logQuestion(`[Có fallback Groq] ${question}`);
  try {
    const result = await chatViaBifrost(
      { model: BUDGET_GEMINI_MODEL, fallbacks: [GROQ_MODEL], messages },
      budgetHeaders,
    );
    logAnswer(
      result.answer,
      result.latencyMs,
      `model: ${result.servedModel} | fallback: ${result.usedFallback}`,
    );
  } catch (error) {
    logInfo(`❌ Vẫn bị chặn: ${error.message}`);
  }
}

// =======================================================================
// PHẦN 2: PROMPT Ở GATEWAY — APP CHỈ GỬI CÂU HỎI
// =======================================================================

/**
 * System prompt lưu ở gateway, app chỉ gửi câu hỏi. Gửi cùng 1 câu hỏi 3 lần:
 * không prompt, prompt v1, prompt v2.
 *
 * - `x-bf-prompt-id`: gateway thêm system prompt vào trước câu hỏi.
 * - `x-bf-prompt-version`: chọn version. Không gửi → dùng version mới nhất.
 * - Đổi prompt: commit version mới trên UI, không sửa code, không deploy lại app.
 * - Sai prompt ID hoặc version → không báo lỗi, chỉ là không có system prompt.
 *   Sai version cũng không tự dùng version mới nhất.
 */
async function gatewayPrompt() {
  logStep("Phần 2: Prompt ở gateway");

  const promptId = process.env.BIFROST_PROMPT_ID;
  if (!promptId) {
    logInfo(
      "Chưa có BIFROST_PROMPT_ID trong .env (xem phần Chuẩn bị ở đầu file).",
    );
    return;
  }
  const question = "Kubernetes Pod là gì?";
  // Chỉ có câu hỏi, không có system message
  const body = {
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: question }],
  };

  const attempts = [
    { label: "Không có prompt", headers: {} },
    {
      label: "Prompt v1",
      headers: {
        "x-bf-prompt-id": promptId,
        "x-bf-prompt-version": "1",
      },
    },
    {
      label: "Prompt v2",
      headers: {
        "x-bf-prompt-id": promptId,
        "x-bf-prompt-version": "2",
      },
    },
  ];
  for (const { label, headers } of attempts) {
    logQuestion(`[${label}] ${question}`);
    const result = await chatViaBifrost(body, headers);
    logAnswer(result.answer, result.latencyMs);
  }
}

async function main() {
  await budgetLimits(); // Phần 1: dùng virtual key demo riêng, không ảnh hưởng các bài khác
  await gatewayPrompt(); // Phần 2: cần tạo prompt trên UI trước (phần Chuẩn bị ở đầu file)
}

runLesson(main);
