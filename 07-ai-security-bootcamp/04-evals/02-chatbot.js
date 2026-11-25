// =======================================================================
// EVAL 2: APP CẦN TEST — CHATBOT HỎI ĐÁP CHÍNH SÁCH ĐỔI TRẢ
//
// Mục đích: chatbot nhỏ gọi Gemini, có 2 bản prompt, để 02-promptfoo-demo.yaml so bản nào tốt hơn.
// Không chạy file này trực tiếp, chạy file YAML.
//
// 1. Luồng khi Promptfoo test:
//        Promptfoo → callApi(câu hỏi) → askBot() → Gemini → { output: câu trả lời } → Promptfoo chấm
//
// 2. Hai bản prompt, chỉ khác nhau 2 câu ràng buộc:
//    - `strict` (chặt): chỉ được dùng chính sách, không có thì trả lời "I don't know."
//    - `loose` (lỏng): bỏ 2 câu đó → bot tự dùng kiến thức bên ngoài, dễ bịa.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

// ===== 1. CHÍNH SÁCH VÀ 2 BẢN PROMPT =====

const POLICY = `Returns are accepted within 30 days of purchase.
Items must be unused and in original packaging.
Customers pay return shipping unless the item is defective.
Approved refunds are processed within 5 to 7 business days.`;

// 2 bản prompt, chỉ khác 2 câu ràng buộc:
// - `strict` (chặt): chỉ dùng chính sách, không có thì trả lời "I don't know."
// - `loose` (lỏng): bỏ 2 câu đó → bot tự dùng kiến thức bên ngoài, dễ bịa → xem eval có bắt được không
const SYSTEM_PROMPTS = {
  strict: `You are a customer support assistant. Answer using ONLY the policy below.
If the policy does not contain the answer, reply exactly: "I don't know."

Policy:
${POLICY}`,

  loose: `You are a customer support assistant.

Policy:
${POLICY}`,
};

// ===== 2. APP =====

// temperature: 0 → hỏi lại cùng câu thì trả lời gần như giống nhau, so 2 bản prompt mới công bằng
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

/** Gửi Gemini system prompt của bản `version` kèm câu hỏi, trả về câu trả lời. */
async function askBot(question, version) {
  const response = await llm.invoke([
    ["system", SYSTEM_PROMPTS[version]],
    ["human", question],
  ]);

  return response.text;
}

// ===== 3. PROVIDER CHO PROMPTFOO =====

/** Provider cho Promptfoo. `options.config.version` lấy từ YAML: `strict` hoặc `loose`. */
class ChatbotProvider {
  constructor(options) {
    this.version = options.config.version;
  }

  id() {
    return `chatbot-${this.version}`;
  }

  /** Promptfoo gọi hàm này với từng câu hỏi. Trả về `{ output }` là câu trả lời để chấm. */
  async callApi(prompt) {
    const answer = await askBot(prompt, this.version);
    return { output: answer };
  }
}

module.exports = ChatbotProvider;
