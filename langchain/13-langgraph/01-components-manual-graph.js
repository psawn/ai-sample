// =======================================================================
// LANGGRAPH - BƯỚC 1: COMPONENTS (BẢN DỰNG GRAPH BẰNG TAY)
//
// Agent nghiên cứu: trả lời câu hỏi, cần thì gọi tool web_search để tra cứu.
// Agent dựng tay bằng StateGraph ở agent.js -> thấy rõ từng node chạy thế nào.
// Hỏi từ dễ (không gọi tool) tới khó (nhiều tool nối tiếp).
//
// Bản createAgent (code gọn, hợp cho dự án thật): 01-components-create-agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent");
const { webSearch } = require("./tool");

// System prompt: trợ lý nghiên cứu, được gọi tool nhiều lần (song song hoặc nối tiếp).
const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// In câu trả lời cuối, tách riêng khỏi log của các node.
function printAnswer(result) {
  console.log(`\n>>> KẾT QUẢ CUỐI: ${result.messages.at(-1).content}\n`);
}

// In sơ đồ graph dạng Mermaid.
// Dán vào https://mermaid.live để xem hình: node nào nối node nào, rẽ nhánh ở đâu.
async function printGraph(agent) {
  const mermaid = await agent.graph.getGraph().drawMermaid();
  console.log(
    "\n----- Sơ đồ Graph (dán vào https://mermaid.live để xem) -----",
  );
  console.log(mermaid);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });
  // Agent ở agent.js: Model + tools + system prompt.
  const abot = new Agent(llm, [webSearch], prompt);

  // Bật dòng dưới để in sơ đồ graph trước khi chạy.
  // await printGraph(abot);

  // Câu 1: kiến thức phổ thông -> Model tự trả lời, không gọi tool.
  console.log(
    "\n========== Câu 1: câu hỏi phổ thông - model tự trả lời, KHÔNG gọi tool ==========",
  );
  const result1 = await abot.graph.invoke({
    messages: [new HumanMessage("What is the capital of Australia?")],
  });
  printAnswer(result1);

  // Câu 2: thông tin ít phổ biến -> Model không chắc, phải gọi tool.
  console.log(
    "\n========== Câu 2: câu hỏi ít phổ biến - model KHÔNG tự tin, phải gọi tool ==========",
  );
  const result2 = await abot.graph.invoke({
    messages: [
      new HumanMessage(
        "According to Wikipedia, what is the elevation in meters of Nauru's highest point?",
      ),
    ],
  });
  printAnswer(result2);

  // Câu 3 và 4: tạm tắt cho gọn log. Bản createAgent đã bật sẵn.
  // console.log("\n========== Câu 3: nhiều tool call cùng lúc ==========");
  // const result3 = await abot.graph.invoke({
  //   messages: [
  //     new HumanMessage(
  //       "What is the capital of France, and what is the capital of Japan?",
  //     ),
  //   ],
  // });
  // printAnswer(result3);

  // console.log(
  //   "\n========== Câu 4: nhiều bước suy luận nối tiếp nhau ==========",
  // );
  // const query = `Who won the super bowl in 2024?
  // In what state is the winning team headquarters located?
  // What is the GDP of that state?
  // Answer each question.`;
  // const result4 = await abot.graph.invoke({
  //   messages: [new HumanMessage(query)],
  // });
  // printAnswer(result4);
}

main();
