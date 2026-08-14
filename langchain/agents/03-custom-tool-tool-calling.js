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
// => Xem file 03-custom-tool-legacy.js để so sánh với cách cũ (đã deprecated).
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { tool } = require("@langchain/core/tools");
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

// tool(): hàm dựng sẵn của LangChain JS, biến 1 hàm JS bình thường thành 1 Tool mà agent
// có thể gọi - tương tự Calculator/WikipediaQueryRun, chỉ khác là tool này tự viết. Cần
// khai báo rõ name/description/schema vì đó là thứ agent đọc để biết khi nào nên gọi.
//
// Tool "time" có nhiệm vụ duy nhất:
//   → trả về ngày hôm nay
const time = tool(
  // Hàm không nhận tham số, dù schema bên dưới khai báo input là string - tool() bắt
  // buộc phải có schema kể cả khi không cần input. Model truyền gì vào cũng bị bỏ qua,
  // vì tool này luôn trả về đúng 1 kết quả: ngày hôm nay.
  async () => {
    // Trả về ngày hôm nay, định dạng YYYY-MM-DD.
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

// Tool có sẵn mà Agent được phép dùng khi cần, ghép thêm tool "time" tự viết ở trên.
const tools = [
  new Calculator(),
  new WikipediaQueryRun({
    topKResults: 1,
    maxDocContentLength: 2000,
  }),
  time,
];

// Prompt này phải tự viết (bản legacy được thư viện dựng sẵn, ẩn bên trong). "placeholder"
// là chỗ chèn 1 danh sách message; "agent_scratchpad" là lịch sử tool đã gọi + kết quả
// (vd: "đã gọi time, kết quả là ..."), giúp model biết nó đã làm gì.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

async function main() {
  // agent: Ghép LLM + Tools + Prompt thành 1 Agent (Tool Calling).
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor: chạy vòng lặp gọi agent -> nếu agent muốn gọi tool thì tự thực thi ->
  // đưa kết quả về cho agent -> lặp lại tới khi agent trả lời xong.
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

  // Lưu ý: agent đôi khi suy luận sai (vd: tự đoán bừa 1 ngày thay vì gọi tool "time").
  // Nếu gặp lỗi hoặc kết quả sai, hãy thử chạy lại.
  try {
    const result = await agentExecutor.invoke({
      input: "whats the date today?",
    });
    console.log("\n========== Kết quả (Custom Tool) ==========");
    console.log(result.output);
  } catch (error) {
    console.log("exception on external access");
  }
}

main();
