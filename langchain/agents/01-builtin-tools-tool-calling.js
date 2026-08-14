// File này minh hoạ cách HIỆN HÀNH (khuyến nghị) để tạo Agent.
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
// Tool Calling là cách Agent hiện hành hoạt động:
//   LLM trả về thẳng "gọi Tool nào, tham số gì" dạng JSON (không cần viết text theo
//   format ReAct), LangChain đọc thẳng JSON đó để gọi Tool - không cần parse text.
//
// => Xem file 01-builtin-tools-legacy.js để so sánh với cách cũ (đã deprecated).
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
// Calculator và WikipediaQueryRun là Tool dựng sẵn - mỗi Tool chỉ làm đúng 1 việc, không
// tự quyết định gì. LLM mới là bên quyết định khi nào cần gọi Tool nào.
const { Calculator } = require("@langchain/community/tools/calculator");
const {
  WikipediaQueryRun,
} = require("@langchain/community/tools/wikipedia_query_run");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

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

// Prompt này phải tự viết (bản legacy được thư viện dựng sẵn, ẩn bên trong). "placeholder"
// là chỗ chèn 1 danh sách message; "agent_scratchpad" là lịch sử tool đã gọi + kết quả
// (vd: "đã gọi Calculator, kết quả 75"), giúp model biết nó đã làm gì.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

async function main() {
  // agent: Ghép LLM + Tools + Prompt thành 1 Agent (Tool Calling). Bên trong, hàm này gọi
  // llm.bindTools(tools) để báo cho Gemini biết trước danh sách tool - nhờ vậy khi cần,
  // Gemini trả lời ngay bằng tên tool + tham số dạng JSON, không cần LangChain đoán qua text.
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor: chạy vòng lặp gọi agent -> nếu agent muốn gọi tool (vd: Calculator)
  // thì tự thực thi -> đưa kết quả về cho agent -> lặp lại tới khi agent trả lời xong.
  //   - handleParsingErrors (true): dù tool-calling trả JSON có cấu trúc, model vẫn có thể
  //     trả tham số sai kiểu hoặc thiếu field bắt buộc - đưa lỗi đó vào quan sát tiếp theo
  //     cho agent tự sửa, thay vì crash chương trình.
  //   - verbose (true): in log chi tiết LLM nghĩ gì -> chọn Tool nào -> Tool trả kết quả gì.
  const agentExecutor = new AgentExecutor({
    agent,
    tools,
    handleParsingErrors: true,
    verbose: true,
  });

  const mathResult = await agentExecutor.invoke({
    input: "What is the 25% of 300?",
  });
  console.log("\n========== Kết quả (Calculator) ==========");
  console.log(mathResult.output);

  const question =
    "Tom M. Mitchell is an American computer scientist \
and the Founders University Professor at Carnegie Mellon University (CMU) \
what book did he write?";
  const wikiResult = await agentExecutor.invoke({ input: question });
  console.log("\n========== Kết quả (Wikipedia) ==========");
  console.log(wikiResult.output);
}

main();
