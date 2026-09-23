// =======================================================================
// AGENTS - BƯỚC 1: TOOL DỰNG SẴN (CALCULATOR, WIKIPEDIA) - CÁCH CŨ (ReAct)
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
// ReAct: LLM viết text theo format Thought -> Action -> Observation -> Final Answer.
// LangChain parse text đó để biết gọi Tool nào. Sai format -> lỗi parse.
//
// Cách mới (Tool Calling): 01-builtin-tools-tool-calling.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Calculator } = require("@langchain/community/tools/calculator");
const {
  WikipediaQueryRun,
} = require("@langchain/community/tools/wikipedia_query_run");
const { initializeAgentExecutorWithOptions } = require("@langchain/classic/agents");

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

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Agent kiểu ReAct, prompt do thư viện dựng sẵn.
  // - agentType "chat-zero-shot-react-description": chọn Tool chỉ dựa vào
  //   description, không cần ví dụ mẫu (zero-shot).
  // - handleParsingErrors: LLM viết sai format -> gửi lỗi lại cho LLM tự sửa.
  // - verbose: in log từng bước: LLM nghĩ gì, gọi Tool nào, Tool trả gì.
  const agent = await initializeAgentExecutorWithOptions(tools, llm, {
    agentType: "chat-zero-shot-react-description",
    handleParsingErrors: true,
    verbose: true,
  });

  // Câu 1: tính toán -> kỳ vọng gọi Calculator.
  const mathResult = await agent.invoke({
    input: "What is the 25% of 300?",
  });
  console.log("\n========== Kết quả (Calculator) ==========");
  console.log(mathResult.output);

  // Câu 2: hỏi về 1 người -> kỳ vọng gọi Wikipedia.
  const question =
    "Tom M. Mitchell is an American computer scientist \
and the Founders University Professor at Carnegie Mellon University (CMU) \
what book did he write?";
  const wikiResult = await agent.invoke({ input: question });
  console.log("\n========== Kết quả (Wikipedia) ==========");
  console.log(wikiResult.output);
}

main();
