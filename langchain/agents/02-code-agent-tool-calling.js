// File này minh hoạ cách HIỆN HÀNH (khuyến nghị) để tạo Agent.
//
// Agent = LLM + Tools
//
// LLM:
//   - Đọc yêu cầu
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
// => Xem file 02-code-agent-legacy.js để so sánh với cách cũ (đã deprecated).
require("dotenv").config();

const vm = require("vm");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Tool } = require("@langchain/core/tools");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

// LLM = "bộ não" của Agent, đọc yêu cầu và quyết định cần làm gì.
// Trong bài này, LLM sẽ viết JavaScript code để giải quyết yêu cầu (LLM không tự chạy code).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tool này: chạy 1 đoạn code JavaScript, trả về output của nó.
// LLM: tự viết ra đoạn code cần chạy (LLM không tự chạy được code).
// LangChain: gọi hàm này để thực thi code đó (dùng module "vm" của Node, chạy trong môi
// trường tách biệt), rồi đưa kết quả console.log về lại cho LLM.
// Vd: code "console.log(1 + 1)" -> tool trả về "2".
class JavaScriptREPLTool extends Tool {
  name = "javascript_repl";

  description =
    "A JavaScript (Node.js) shell. Use this to execute JavaScript commands. " +
    "Input should be a valid JavaScript snippet. If you want to see the output " +
    "of a value, you should print it out with console.log(...).";

  async _call(code) {
    const logs = [];
    const sandbox = {
      console: {
        log: (...args) => logs.push(args.map((a) => String(a)).join(" ")),
      },
    };
    try {
      // Tạo môi trường riêng để chạy code.
      vm.createContext(sandbox);
      // Thực thi code do LLM viết ra.
      vm.runInContext(code, sandbox, { timeout: 5000 });
      // Tool chỉ trả về những gì được in bằng console.log().
      return logs.length > 0
        ? logs.join("\n")
        : "Code đã chạy xong nhưng không có output (hãy dùng console.log để in kết quả).";
    } catch (error) {
      return `Lỗi khi thực thi code: ${error.message}`;
    }
  }
}

// Agent chỉ có 1 Tool: JavaScriptREPLTool.
const tools = [new JavaScriptREPLTool()];

// Prompt này phải tự viết (bản legacy được thư viện dựng sẵn, ẩn bên trong). "placeholder"
// là chỗ chèn 1 danh sách message; "agent_scratchpad" là lịch sử tool đã gọi + kết quả
// (vd: "đã chạy code gì, kết quả gì"), giúp model biết nó đã làm gì.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

async function main() {
  // agent: Ghép LLM + Tools + Prompt thành 1 Agent (Tool Calling). Bên trong, hàm này gọi
  // llm.bindTools(tools) để báo cho Gemini biết trước có tool javascript_repl - nhờ vậy
  // khi cần chạy code, Gemini trả lời ngay bằng tên tool + code dạng JSON, không cần
  // LangChain đoán qua text.
  const agent = createToolCallingAgent({ llm, tools, prompt });

  // agentExecutor: chạy vòng lặp gọi agent -> nếu agent muốn gọi javascript_repl thì tự
  // thực thi code -> đưa kết quả về cho agent -> lặp lại tới khi agent trả lời xong.
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

  const customerList = [
    ["Harrison", "Chase"],
    ["Lang", "Chain"],
    ["Dolly", "Too"],
    ["Elle", "Elem"],
    ["Geoff", "Fusion"],
    ["Trance", "Former"],
    ["Jen", "Ayai"],
  ];

  // Agent không tự sort danh sách này - LLM sẽ viết JavaScript để sort, rồi Agent đưa
  // code đó cho JavaScriptREPLTool chạy.
  const result = await agentExecutor.invoke({
    input: `Sort these customers by last name and then first name and print the output: ${JSON.stringify(
      customerList,
    )}`,
  });

  console.log("\n========== Kết quả (Code Agent) ==========");
  console.log(result.output);
}

main();
