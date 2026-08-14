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
// => Xem file 03-custom-tool-tool-calling.js để biết cách Tool Calling hiện hành, không
//    cần LLM viết theo format ReAct như cách cũ.
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { tool } = require("@langchain/core/tools");
const { Calculator } = require("@langchain/community/tools/calculator");
const {
  WikipediaQueryRun,
} = require("@langchain/community/tools/wikipedia_query_run");
const { initializeAgentExecutorWithOptions } = require("langchain/agents");

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

async function main() {
  // agent: Tạo Agent kiểu ReAct từ LLM + Tools.
  //   - handleParsingErrors (true): nếu LLM viết sai format, đưa lỗi đó lại cho LLM tự sửa
  //     thay vì crash ngay.
  //   - verbose (true): in log chi tiết LLM nghĩ gì -> chọn Tool nào -> Tool trả kết quả gì.
  const agent = await initializeAgentExecutorWithOptions(tools, llm, {
    agentType: "chat-zero-shot-react-description",
    handleParsingErrors: true,
    verbose: true,
  });

  // Lưu ý: agent đôi khi suy luận sai (vd: tự đoán bừa 1 ngày thay vì gọi tool "time").
  // Nếu gặp lỗi hoặc kết quả sai, hãy thử chạy lại.
  try {
    const result = await agent.invoke({ input: "whats the date today?" });
    console.log("\n========== Kết quả (Custom Tool) ==========");
    console.log(result.output);
  } catch (error) {
    console.log("exception on external access");
  }
}

main();
