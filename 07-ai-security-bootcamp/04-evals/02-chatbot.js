// =======================================================================
// EVAL 2: APP CẦN TEST — CHATBOT HỎI ĐÁP CHÍNH SÁCH ĐỔI TRẢ
//
// Mục tiêu: chatbot nhỏ có 2 bản system prompt, để 02-promptfoo-demo.yaml so bản nào tốt hơn.
// File này không chạy trực tiếp: chạy file YAML, YAML sẽ gọi file này.
//
// 1. Luồng khi Promptfoo test:
//        Promptfoo → callApi(câu hỏi) → askBot() → LLM → { output: câu trả lời } → Promptfoo chấm
//
// 2. Hai bản system prompt, chỉ khác nhau 2 câu ràng buộc:
//    - `strict` (chặt): chỉ được dùng chính sách, không có thì trả lời "I don't know."
//    - `loose` (lỏng): bỏ 2 câu đó → bot dễ dùng kiến thức bên ngoài và bịa.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

// ===== CHÍNH SÁCH VÀ 2 BẢN PROMPT =====

const POLICY = `Returns are accepted within 30 days of purchase.
Items must be unused and in original packaging.
Customers pay return shipping unless the item is defective.
Approved refunds are processed within 5 to 7 business days.`;

// 2 bản system prompt (xem mục 2 ở đầu file)
const SYSTEM_PROMPTS = {
  strict: `You are a customer support assistant. Answer using ONLY the policy below.
If the policy does not contain the answer, reply exactly: "I don't know."

Policy:
${POLICY}`,

  loose: `You are a customer support assistant.

Policy:
${POLICY}`,
};

// ===== APP =====

// `temperature: 0` để bot trả lời ổn định → kết quả 2 bản khác nhau là do system prompt
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

/** Hỏi LLM với system prompt của bản `version`, trả về câu trả lời. */
async function askBot(question, version) {
  const response = await llm.invoke([
    ["system", SYSTEM_PROMPTS[version]],
    ["human", question],
  ]);

  return response.text;
}

// ===== PROVIDER CHO PROMPTFOO =====

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
