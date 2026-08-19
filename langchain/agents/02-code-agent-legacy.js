// File này minh hoạ cách CŨ (đã deprecated) để tạo Agent.
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
// ReAct là cách Agent cũ hoạt động:
//   Thought → Action → Observation → Final Answer
//
// Với cách này, LLM phải viết output theo 1 format cố định, LangChain phải parse output đó
// để biết cần gọi Tool nào, input là gì. Nếu LLM viết sai format → có thể lỗi parse.
//
// => Xem file 02-code-agent-tool-calling.js để biết cách Tool Calling hiện hành, không
//    cần LLM viết theo format ReAct như cách cũ.
require("dotenv").config();

const vm = require("vm");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Tool } = require("@langchain/core/tools");
const { initializeAgentExecutorWithOptions } = require("langchain/agents");

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

async function main() {
  // agent: Tạo Agent kiểu ReAct từ LLM + Tool (Agent chỉ có 1 Tool: JavaScriptREPLTool).
  //   - handleParsingErrors (true): nếu LLM viết sai format, đưa lỗi đó lại cho LLM tự sửa
  //     thay vì crash ngay.
  //   - verbose (true): in log chi tiết LLM nghĩ gì -> chọn Tool nào -> Tool trả kết quả gì.
  const agent = await initializeAgentExecutorWithOptions(
    [new JavaScriptREPLTool()],
    llm,
    {
      agentType: "chat-zero-shot-react-description",
      handleParsingErrors: true,
      verbose: true,
    },
  );

  const customerList = [
    ["Harrison", "Chase"],
    ["Lang", "Chain"],
    ["Dolly", "Too"],
    ["Elle", "Elem"],
    ["Geoff", "Fusion"],
    ["Trance", "Former"],
    ["Jen", "Ayai"],
  ];

  // Agent không tự sort danh sách này:
  // 1. LLM viết JavaScript để sort.
  // 2. Agent đưa code đó cho JavaScriptREPLTool chạy.
  const result = await agent.invoke({
    input: `Sort these customers by last name and then first name and print the output: ${JSON.stringify(
      customerList,
    )}`,
  });

  console.log("\n========== Kết quả (Code Agent) ==========");
  console.log(result.output);
}

main();
