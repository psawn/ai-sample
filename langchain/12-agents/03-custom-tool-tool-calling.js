// =======================================================================
// AGENTS - BƯỚC 3: TỰ VIẾT TOOL (CUSTOM TOOL) - CÁCH MỚI (TOOL CALLING)
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
// Tool Calling (cách hiện hành, khuyến nghị):
// - LLM trả JSON: tên Tool + tham số.
// - LangChain đọc JSON để gọi Tool, không cần parse text như ReAct.
//
// Cách cũ (ReAct, deprecated): 03-custom-tool-legacy.js.
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
const { AgentExecutor, createToolCallingAgent } = require("@langchain/classic/agents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

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

// Prompt phải tự viết. Bản ReAct dùng prompt thư viện dựng sẵn.
// - "placeholder": chỗ chèn 1 danh sách message.
// - agent_scratchpad: các Tool đã gọi + kết quả, trong lần invoke() hiện tại.
//   AgentExecutor tự điền, reset mỗi lần invoke().
//   Vd: "hôm nay ngày mấy?" -> gọi "time" -> "2026-08-19" -> vào scratchpad -> LLM trả lời.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // agent: LLM + Tools + Prompt. Chỉ quyết định bước tiếp theo, không tự chạy Tool.
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor: vòng lặp chạy agent.
  // 1. Gọi agent -> nhận Tool cần gọi.
  // 2. Chạy Tool, đưa kết quả vào scratchpad.
  // 3. Lặp lại tới khi agent trả Final Answer.
  // - handleParsingErrors: tham số sai kiểu/thiếu field -> gửi lỗi lại cho agent tự sửa.
  // - verbose: in log từng bước: LLM nghĩ gì, gọi Tool nào, Tool trả gì.
  const agentExecutor = new AgentExecutor({
    agent,
    tools,
    handleParsingErrors: true,
    verbose: true,
  });

  // Hỏi ngày hôm nay -> kỳ vọng gọi tool "time".
  // Lưu ý: đôi khi LLM đoán bừa 1 ngày thay vì gọi "time". Sai thì chạy lại.
  try {
    const result = await agentExecutor.invoke({
      input: "whats the date today?",
    });
    console.log("\n========== Kết quả (Custom Tool) ==========");
    console.log(result.output);
  } catch (error) {
    console.error(error);
  }
}

main();
