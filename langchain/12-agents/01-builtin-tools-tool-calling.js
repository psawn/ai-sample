// =======================================================================
// AGENTS - BƯỚC 1: TOOL DỰNG SẴN (CALCULATOR, WIKIPEDIA) - CÁCH MỚI (TOOL CALLING)
//
// Agent = LLM + Tools:
// - LLM: đọc câu hỏi, quyết định trả lời luôn hay gọi Tool nào.
// - Tool: làm đúng 1 việc LLM yêu cầu, không tự quyết định.
//
// Flow:
// 1. LLM đọc câu hỏi, chọn Tool.
// 2. Tool chạy, trả kết quả cho LLM.
// 3. Lặp lại tới khi LLM đủ thông tin -> Final Answer.
//
// Tool Calling (cách hiện hành, khuyến nghị):
// - LLM trả JSON: tên Tool + tham số.
// - LangChain đọc JSON để gọi Tool, không cần parse text như ReAct.
//
// Cách cũ (ReAct, deprecated): 01-builtin-tools-legacy.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Calculator } = require("@langchain/community/tools/calculator");
const {
  WikipediaQueryRun,
} = require("@langchain/community/tools/wikipedia_query_run");
const { AgentExecutor, createToolCallingAgent } = require("@langchain/classic/agents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

// LLM: "bộ não" của Agent, quyết định gọi Tool nào.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tool dựng sẵn Agent được dùng:
// - Calculator: tính biểu thức toán.
// - WikipediaQueryRun: tra Wikipedia. Lấy 1 bài, tối đa 2000 ký tự.
const tools = [
  new Calculator(),
  new WikipediaQueryRun({
    topKResults: 1,
    maxDocContentLength: 2000,
  }),
];

// Prompt phải tự viết. Bản ReAct dùng prompt thư viện dựng sẵn.
// - "placeholder": chỗ chèn 1 danh sách message.
// - agent_scratchpad: các Tool đã gọi + kết quả, trong lần invoke() hiện tại.
//   AgentExecutor tự điền, reset mỗi lần invoke().
//   Vd: "25% của 300?" -> gọi Calculator -> "75" -> vào scratchpad -> LLM trả lời.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // agent: LLM + Tools + Prompt. Chỉ quyết định bước tiếp theo, không tự chạy Tool.
  // Bên trong gọi llm.bindTools(tools) -> Gemini trả tên Tool + tham số dạng JSON.
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor: vòng lặp chạy agent.
  // 1. Gọi agent -> nhận Tool cần gọi.
  // 2. Chạy Tool, đưa kết quả vào scratchpad.
  // 3. Lặp lại tới khi agent trả Final Answer.
  // - handleParsingErrors: tham số sai kiểu/thiếu field -> gửi lỗi lại cho agent
  //   tự sửa, không crash.
  // - verbose: in log từng bước: LLM nghĩ gì, gọi Tool nào, Tool trả gì.
  const agentExecutor = new AgentExecutor({
    agent,
    tools,
    handleParsingErrors: true,
    verbose: true,
  });

  // Câu 1: tính toán -> kỳ vọng gọi Calculator.
  const mathResult = await agentExecutor.invoke({
    input: "What is the 25% of 300?",
  });
  console.log("\n========== Kết quả (Calculator) ==========");
  console.log(mathResult.output);

  // Câu 2: hỏi về 1 người -> kỳ vọng gọi Wikipedia.
  const question =
    "Tom M. Mitchell is an American computer scientist \
and the Founders University Professor at Carnegie Mellon University (CMU) \
what book did he write?";
  const wikiResult = await agentExecutor.invoke({ input: question });
  console.log("\n========== Kết quả (Wikipedia) ==========");
  console.log(wikiResult.output);
}

main();
