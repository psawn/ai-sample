// =======================================================================
// AGENTS - BƯỚC 3: TỰ VIẾT TOOL (CUSTOM TOOL) - CÁCH CŨ (ReAct)
//
// Ngoài Tool dựng sẵn, có thể tự viết Tool từ 1 hàm JS thường.
// Ví dụ: Tool "time" trả về ngày hôm nay. LLM không tự biết ngày hiện tại,
// nên phải hỏi Tool.
//
// Flow:
// 1. LLM đọc câu hỏi, chọn Tool (dựa vào name + description).
// 2. Tool chạy, trả kết quả cho LLM.
// 3. LLM dùng kết quả để trả lời -> Final Answer.
//
// ReAct: LLM viết text theo format Thought -> Action -> Observation -> Final Answer.
// LangChain parse text đó để biết gọi Tool nào. Sai format -> lỗi parse.
//
// Cách mới (Tool Calling): 03-custom-tool-tool-calling.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { tool } = require("@langchain/core/tools");
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

// tool(hàm, { name, description, schema }): biến hàm JS thành Tool.
// - name + description: LLM đọc để quyết định khi nào gọi.
// - schema: kiểu tham số LLM phải truyền.
const time = tool(
  // Hàm không cần tham số. tool() bắt buộc có schema nên vẫn khai báo z.string(),
  // LLM truyền gì cũng bị bỏ qua.
  async () => {
    // Ngày hôm nay, dạng YYYY-MM-DD.
    return new Date().toISOString().slice(0, 10);
  },
  {
    name: "time",
    description:
      "Returns todays date, use this for any questions related to knowing " +
      "todays date. The input should always be an empty string, and this " +
      "function will always return todays date - any date mathmatics " +
      "should occur outside this function.",
    schema: z.string(),
  },
);

// Tool dựng sẵn + tool "time" tự viết. Agent dùng chung, không phân biệt.
const tools = [
  new Calculator(),
  new WikipediaQueryRun({
    topKResults: 1,
    maxDocContentLength: 2000,
  }),
  time,
];

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Agent kiểu ReAct, prompt do thư viện dựng sẵn.
  // - handleParsingErrors: LLM viết sai format -> gửi lỗi lại cho LLM tự sửa.
  // - verbose: in log từng bước: LLM nghĩ gì, gọi Tool nào, Tool trả gì.
  const agent = await initializeAgentExecutorWithOptions(tools, llm, {
    agentType: "chat-zero-shot-react-description",
    handleParsingErrors: true,
    verbose: true,
  });

  // Hỏi ngày hôm nay -> kỳ vọng gọi tool "time".
  // Lưu ý: đôi khi LLM đoán bừa 1 ngày thay vì gọi "time". Sai thì chạy lại.
  try {
    const result = await agent.invoke({ input: "whats the date today?" });
    console.log("\n========== Kết quả (Custom Tool) ==========");
    console.log(result.output);
  } catch (error) {
    console.error(error);
  }
}

main();
