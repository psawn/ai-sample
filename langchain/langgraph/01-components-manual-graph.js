// LangGraph Components - bản DỰNG GRAPH BẰNG TAY (StateGraph)
// Mục tiêu:
//   - Dựng Graph thủ công (StateGraph, addNode, addConditionalEdges) để thấy rõ bên trong
//     Agent hoạt động thế nào - tốt cho việc HỌC cơ chế.
//   - Chạy thử Agent ở agent.js với câu hỏi từ đơn giản (1 tool call) tới phức tạp (nhiều
//     tool call nối tiếp).
// Lưu ý:
//   Viết nhanh cho việc thật thì xem bản createAgent ở 01-components-create-agent.js.

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// In câu trả lời cuối cùng, cách biệt hẳn với log của các Node bên trên cho dễ nhận ra
// đâu là kết quả, đâu là log debug.
function printAnswer(result) {
  console.log(`\n>>> KẾT QUẢ CUỐI: ${result.messages.at(-1).content}\n`);
}

// In sơ đồ graph dạng Mermaid text - dán đoạn text này vào https://mermaid.live để xem
// hình trực quan (node nào nối node nào, rẽ nhánh ở đâu).
async function printGraph(agent) {
  const mermaid = await agent.graph.getGraph().drawMermaid();
  console.log(
    "\n----- Sơ đồ Graph (dán vào https://mermaid.live để xem) -----",
  );
  console.log(mermaid);
}

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });
  const abot = new Agent(llm, [webSearch], prompt);

  // await printGraph(abot);

  console.log(
    "\n========== Câu 1: câu hỏi phổ thông - model tự trả lời, KHÔNG gọi tool ==========",
  );
  const result1 = await abot.graph.invoke({
    messages: [new HumanMessage("What is the capital of Australia?")],
  });
  printAnswer(result1);

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
