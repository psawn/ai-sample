// =======================================================
// ReAct Agent (cách viết CŨ)
//
// "Bộ não" dùng chung cho 01-react-manual-steps.js và 02-react-auto-loop.js.
//
// ReAct = Agent tự lặp theo 1 vòng:
//   Thought (nghĩ) -> Action (chọn hành động) -> PAUSE
//   -> Observation (kết quả) -> ... -> Answer (câu trả lời cuối)
//
// Cách mới hơn, nên dùng cho sản phẩm thật: Native Tool Calling.
// Xem cùng ví dụ này viết lại bằng Native Tool Calling ở
// 03-native-tool-calling-manual-messages.js
// (hoặc ../tool-routing/05-routing.js, ../tool-routing/06-agent-executor.js).
// =======================================================
require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// LLM = "bộ não" của Agent - đọc lịch sử hội thoại, rồi quyết định trả lời luôn hay cần
// chạy Action nào trước.
//
// thinkingConfig { thinkingBudget: 0 }: tắt "thinking" (Gemini tự suy nghĩ ngầm trước khi
// trả lời). Tại sao phải tắt:
// - ReAct ở đây bắt model viết TIẾP đúng theo 1 cú pháp text cố định, không dùng Tool
//   Calling chuẩn.
// - Nếu để thinking bật, từ lượt Observation thứ 2 trở đi, Gemini hay trả về nội dung
//   RỖNG kèm lỗi "MALFORMED_RESPONSE".
// - Tắt thinking đi thì model trả lời thẳng, đúng format, hết lỗi trên.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
  thinkingConfig: { thinkingBudget: 0 },
});

// System prompt: "dạy" model cách trả lời theo đúng vòng lặp ReAct ở trên, kèm ví dụ mẫu
// để model bắt chước đúng format (Thought/Action/PAUSE).
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

// response.content của Gemini không phải lúc nào cũng là string. Đôi khi nó là 1 mảng
// (rỗng, hoặc gồm nhiều "part" dạng { text: "..." }). Hàm này gom lại thành 1 string duy
// nhất, để nơi gọi luôn nhận đúng kiểu string mà không cần tự kiểm tra.
function messageContentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
      .join("");
  }
  return String(content ?? "");
}

// In ra toàn bộ mảng messages sắp gửi cho LLM, cho dễ hình dung agent đang "nhớ" những gì.
function logMessages(messages) {
  console.log("\n----- Messages gửi cho LLM -----");
  console.log(messages);
  console.log("---------------------------------");
}

// Class Agent: giữ toàn bộ lịch sử hội thoại (messages), gọi LLM mỗi khi có tin nhắn mới.
//
// Đây là cách lưu lịch sử THỦ CÔNG (manual): this.messages chỉ là 1 mảng JS bình thường,
// tự push() vào, tự truyền cả mảng vào llm.invoke() mỗi lần gọi - không có LangChain
// component nào (RunnableWithMessageHistory, session...) đứng ra quản lý giúp. Nhờ mảng
// này mà model mới "nhớ" được các bước Thought/Action/Observation trước đó.
// So sánh với cách quản lý tự động: xem ../chat-history-manual-vs-auto.js.
class Agent {
  constructor(system = "") {
    this.system = system;
    this.messages = [];
    if (this.system) {
      this.messages.push(new SystemMessage(this.system));
    }
  }

  // Gửi 1 tin nhắn user, gọi LLM, lưu câu trả lời vào lịch sử rồi trả về.
  async call(message) {
    this.messages.push(new HumanMessage(message));
    const result = await this.execute();
    this.messages.push(new AIMessage(result));
    return result;
  }

  // Gọi LLM với toàn bộ lịch sử messages hiện có.
  //
  // Có thử gọi lại tối đa 3 lần nếu content rỗng - phòng khi có lỗi tạm thời (vd: mạng
  // chập chờn). Nguyên nhân chính gây content rỗng (thinking) đã tắt ở trên rồi, nên bình
  // thường sẽ thành công ngay từ lần gọi đầu tiên.
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
