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
//   1. LLM trả về thẳng "gọi Tool nào, tham số gì" dạng JSON (không cần viết text
//      theo format ReAct).
//   2. LangChain đọc thẳng JSON đó để gọi Tool ngay - không cần parse text.
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

// Prompt này phải tự viết (bản legacy được thư viện dựng sẵn, ẩn bên trong):
// - "placeholder": chỗ chèn 1 danh sách message.
//
// "agent_scratchpad" = "Trong lần xử lý này, agent đã làm những gì?"
//   - Để trả lời 1 câu hỏi, agent có thể phải gọi tool nhiều bước (gọi tool -> xem kết
//     quả -> gọi tiếp hoặc trả lời). Đây là nơi lưu "đã gọi tool nào, kết quả gì".
//   - Do AgentExecutor tự tạo và xoá sau mỗi lần invoke(), KHÔNG tồn tại giữa các câu hỏi.
//   - Vd: hỏi "hôm nay ngày mấy?"
//       1. agent gọi tool "time"
//       2. nhận về "2026-08-19"
//       3. lưu bước này vào scratchpad
//       4. trả lời user
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

async function main() {
  // agent = LLM được cấu hình để dùng Tools và quyết định action (không tự chạy tool).
  // agent: Ghép LLM + Tools + Prompt thành 1 Agent (Tool Calling).
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor = chạy Agent Loop, tự thực thi action của agent cho tới khi có Final Answer.
  // agentExecutor: chạy vòng lặp xử lý agent:
  // 1. Gọi agent.
  // 2. Nếu agent muốn gọi tool thì tự thực thi tool đó.
  // 3. Đưa kết quả về cho agent.
  // 4. Lặp lại từ bước 1 tới khi agent trả lời xong.
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
    console.error(error);
  }
}

main();
