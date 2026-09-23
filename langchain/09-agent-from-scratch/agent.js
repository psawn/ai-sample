// =======================================================================
// AGENT FROM SCRATCH - ReAct AGENT (CÁCH CŨ)
//
// Phần dùng chung cho 01-react-manual-steps.js và 02-react-auto-loop.js:
// LLM, system prompt, class Agent (giữ lịch sử + gọi LLM).
//
// ReAct: model lặp theo vòng, viết bằng text:
// 1. Thought: nghĩ cần làm gì.
// 2. Action: chọn action + input, rồi viết PAUSE để dừng.
// 3. Observation: code chạy action, gửi kết quả lại.
// 4. Lặp 1-3 tới khi model viết Answer (câu trả lời cuối).
//
// Cách mới, nên dùng cho sản phẩm thật: Native Tool Calling.
// Cùng ví dụ viết lại: 03-native-tool-calling-manual-messages.js
// (hoặc ../11-tool-routing/05-routing.js, ../11-tool-routing/06-agent-executor.js).
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// LLM: đọc lịch sử, quyết định trả lời luôn hay chạy Action.
//
// thinkingBudget: 0 -> tắt "thinking" (Gemini suy nghĩ ngầm trước khi trả lời).
// Vì sao tắt?
// - ReAct ở đây bắt model viết theo cú pháp text cố định, không dùng Tool Calling.
// - Bật thinking -> từ lượt Observation thứ 2, Gemini hay trả rỗng + lỗi "MALFORMED_RESPONSE".
// - Tắt thinking -> model trả lời thẳng, đúng format.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
  thinkingConfig: { thinkingBudget: 0 },
});

// System prompt: dạy model vòng lặp ReAct.
// Gồm: luật vòng lặp, danh sách action, 1 ví dụ mẫu để model bắt chước format.
const SYSTEM_PROMPT = `
You run in a loop of Thought, Action, PAUSE, Observation.
At the end of the loop you output an Answer
Use Thought to describe your thoughts about the question you have been asked.
Use Action to run one of the actions available to you - then return PAUSE.
Observation will be the result of running those actions.

Your available actions are:

calculate:
e.g. calculate: 4 * 7 / 3
Runs a calculation and returns the number - use JavaScript syntax

average_dog_weight:
e.g. average_dog_weight: Collie
returns average weight of a dog when given the breed

Example session:

Question: How much does a Bulldog weigh?
Thought: I should look the dogs weight using average_dog_weight
Action: average_dog_weight: Bulldog
PAUSE

You will be called again with this:

Observation: A Bulldog weights 51 lbs

You then output:

Answer: A bulldog weights 51 lbs
`.trim();

// response.content của Gemini không phải lúc nào cũng là string.
// Đôi khi là mảng (rỗng, hoặc nhiều part { text: "..." }).
// Gom thành 1 string để nơi gọi khỏi phải kiểm tra kiểu.
// Vd: [{ text: "Thought: " }, { text: "..." }] -> "Thought: ...".
function messageContentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
      .join("");
  }
  return String(content ?? "");
}

// In mảng messages sắp gửi cho LLM, để thấy agent đang "nhớ" gì.
function logMessages(messages) {
  console.log("\n----- Messages gửi cho LLM -----");
  console.log(messages);
  console.log("---------------------------------");
}

// Agent: giữ lịch sử hội thoại (messages), gọi LLM mỗi khi có tin nhắn mới.
//
// Lịch sử lưu thủ công: this.messages là mảng JS thường.
// Mỗi lần gọi: push tin nhắn mới, gửi cả mảng cho llm.invoke().
// Nhờ vậy model "nhớ" các bước Thought/Action/Observation trước đó.
// So sánh cách tự động: ../01-basics/chat-history-manual-vs-auto.js.
class Agent {
  constructor(system = "") {
    this.system = system;
    this.messages = [];
    if (this.system) {
      this.messages.push(new SystemMessage(this.system));
    }
  }

  // 1 lượt: lưu tin nhắn user -> gọi LLM -> lưu câu trả lời -> trả về.
  async call(message) {
    this.messages.push(new HumanMessage(message));
    const result = await this.execute();
    this.messages.push(new AIMessage(result));
    return result;
  }

  // Gọi LLM với toàn bộ lịch sử.
  // Content rỗng -> thử lại, tối đa 3 lần (phòng lỗi tạm thời).
  // Nguyên nhân chính (thinking) đã tắt ở trên, nên thường thành công ngay lần đầu.
  async execute() {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logMessages(this.messages);
      const response = await llm.invoke(this.messages);
      const content = messageContentToString(response.content);
      if (content) return content;
      console.warn(
        `LLM trả về nội dung rỗng (lần ${attempt}/${maxRetries}), đang thử lại...`,
      );
    }
    throw new Error("LLM liên tục trả về nội dung rỗng sau nhiều lần thử lại.");
  }
}

module.exports = { Agent, SYSTEM_PROMPT };
