// File này minh hoạ cách CŨ (đã deprecated) để tạo Agent.
//
// Agent = LLM + Tools
//
// LLM:
//   - Đọc câu hỏi
//   - Quyết định cần làm gì
//   - Chọn Tool nếu cần
//
// Tool:
//   - Thực hiện công việc mà LLM yêu cầu
//
// Flow:
//   User → LLM → chọn Tool → Tool thực thi → kết quả → LLM → Final Answer
//
// ReAct là cách Agent cũ hoạt động:
//   Thought → Action → Observation → Final Answer
//
// Với cách này, LLM phải viết output theo 1 format cố định, LangChain phải parse output đó
// để biết cần gọi Tool nào, input là gì. Nếu LLM viết sai format → có thể lỗi parse.
//
// => Xem file 01-builtin-tools-tool-calling.js để biết cách Tool Calling hiện hành, không
//    cần LLM viết theo format ReAct như cách cũ.
require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
// Calculator và WikipediaQueryRun là Tool dựng sẵn - mỗi Tool chỉ làm đúng 1 việc, không
// tự quyết định gì. LLM mới là bên quyết định khi nào cần gọi Tool nào.
const { Calculator } = require("@langchain/community/tools/calculator");
const {
  WikipediaQueryRun,
} = require("@langchain/community/tools/wikipedia_query_run");
const { initializeAgentExecutorWithOptions } = require("@langchain/classic/agents");

// LLM = "bộ não" của Agent, đọc câu hỏi rồi quyết định: trả lời luôn, hay cần gọi Tool
// nào trước.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tool có sẵn mà Agent được phép dùng khi cần.
const tools = [
  new Calculator(),
  new WikipediaQueryRun({
    topKResults: 1,
    maxDocContentLength: 2000,
  }),
];

async function main() {
  // agent: Tạo Agent kiểu ReAct từ LLM + Tools.
  //   - agentType ("chat-zero-shot-react-description"): Agent chỉ dựa vào description của
  //     từng Tool để chọn, không cần xem ví dụ mẫu trước (zero-shot).
  //   - handleParsingErrors (true): nếu LLM viết sai format, đưa lỗi đó lại cho LLM tự sửa
  //     thay vì crash ngay.
  //   - verbose (true): in log chi tiết LLM nghĩ gì -> chọn Tool nào -> Tool trả kết quả gì.
  const agent = await initializeAgentExecutorWithOptions(tools, llm, {
    agentType: "chat-zero-shot-react-description",
    handleParsingErrors: true,
    verbose: true,
  });

  const mathResult = await agent.invoke({
    input: "What is the 25% of 300?",
  });
  console.log("\n========== Kết quả (Calculator) ==========");
  console.log(mathResult.output);

  const question =
    "Tom M. Mitchell is an American computer scientist \
and the Founders University Professor at Carnegie Mellon University (CMU) \
what book did he write?";
  const wikiResult = await agent.invoke({ input: question });
  console.log("\n========== Kết quả (Wikipedia) ==========");
  console.log(wikiResult.output);
}

main();
