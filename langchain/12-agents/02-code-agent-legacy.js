// =======================================================================
// AGENTS - BƯỚC 2: CODE AGENT (LLM VIẾT CODE, TOOL CHẠY CODE) - CÁCH CŨ (ReAct)
//
// Code Agent: LLM không tự tính kết quả, mà viết code rồi nhờ Tool chạy.
// Hợp với việc LLM dễ làm sai khi "nhẩm": sort, đếm, tính toán nhiều bước.
//
// Flow:
// 1. LLM đọc yêu cầu, viết code JavaScript.
// 2. Tool chạy code, trả output cho LLM.
// 3. Code lỗi -> LLM đọc lỗi, sửa code, chạy lại.
// 4. Có output đúng -> Final Answer.
//
// ReAct: LLM viết text theo format Thought -> Action -> Observation -> Final Answer.
// LangChain parse text đó để biết gọi Tool nào. Sai format -> lỗi parse.
//
// Cách mới (Tool Calling): 02-code-agent-tool-calling.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const vm = require("vm");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Tool } = require("@langchain/core/tools");
const { initializeAgentExecutorWithOptions } = require("@langchain/classic/agents");

// LLM: viết code JavaScript, không tự chạy code.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tool chạy code JavaScript do LLM viết.
// - Chạy bằng module "vm": context riêng, không thấy biến của chương trình chính.
// - Chỉ trả về những gì code in bằng console.log. Vd: "console.log(1 + 1)" -> "2".
// - Lỗi -> trả message lỗi (không throw), để LLM đọc và sửa code.
// Lưu ý: "vm" không phải sandbox bảo mật, chỉ dùng cho demo.
class JavaScriptREPLTool extends Tool {
  name = "javascript_repl";

  // Description: LLM đọc để biết khi nào gọi Tool và phải truyền input gì.
  description =
    "A JavaScript (Node.js) shell. Use this to execute JavaScript commands. " +
    "Input should be a valid JavaScript snippet. If you want to see the output " +
    "of a value, you should print it out with console.log(...).";

  async _call(code) {
    // Context chỉ có console.log, gom output vào logs.
    const logs = [];
    const sandbox = {
      console: {
        log: (...args) => logs.push(args.map((a) => String(a)).join(" ")),
      },
    };
    try {
      vm.createContext(sandbox);
      // timeout 5s: chặn code lặp vô hạn.
      vm.runInContext(code, sandbox, { timeout: 5000 });
      // Không có output -> nhắc LLM dùng console.log.
      return logs.length > 0
        ? logs.join("\n")
        : "Code đã chạy xong nhưng không có output (hãy dùng console.log để in kết quả).";
    } catch (error) {
      return `Lỗi khi thực thi code: ${error.message}`;
    }
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Agent kiểu ReAct, chỉ có 1 Tool: JavaScriptREPLTool.
  // - handleParsingErrors: LLM viết sai format -> gửi lỗi lại cho LLM tự sửa.
  // - verbose: in log từng bước: LLM nghĩ gì, gọi Tool nào, Tool trả gì.
  const agent = await initializeAgentExecutorWithOptions(
    [new JavaScriptREPLTool()],
    llm,
    {
      agentType: "chat-zero-shot-react-description",
      handleParsingErrors: true,
      verbose: true,
    },
  );

  // Dữ liệu test: danh sách khách hàng [tên, họ].
  const customerList = [
    ["Harrison", "Chase"],
    ["Lang", "Chain"],
    ["Dolly", "Too"],
    ["Elle", "Elem"],
    ["Geoff", "Fusion"],
    ["Trance", "Former"],
    ["Jen", "Ayai"],
  ];

  // Yêu cầu sort theo họ, rồi theo tên.
  // Kỳ vọng: LLM viết code sort -> gọi javascript_repl -> trả kết quả Tool in ra.
  const result = await agent.invoke({
    input: `Sort these customers by last name and then first name and print the output: ${JSON.stringify(
      customerList,
    )}`,
  });

  console.log("\n========== Kết quả (Code Agent) ==========");
  console.log(result.output);
}

main();
