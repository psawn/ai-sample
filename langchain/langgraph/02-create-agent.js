// Lesson 2: LangGraph Components - bản dùng createAgent (API HIỆN HÀNH, khuyến nghị)
//
// Cùng 4 câu hỏi, cùng kết quả như 01-manual-graph.js - nhưng không tự dựng StateGraph,
// không tự viết Node "llm"/"action". createAgent (package "langchain") tự dựng graph y hệt
// bên trong, chỉ cần khai báo model, tools, system prompt.
//
// Dùng 01-manual-graph.js khi HỌC cơ chế hoặc cần custom sâu. Dùng file này cho việc thật -
// ít code hơn hẳn, ít chỗ để viết sai.
require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

// In câu trả lời cuối cùng cho dễ nhận ra kết quả. Lưu ý: createAgent là API cấp cao, ẩn
// hết log từng Node bên trong (không thấy được model đang gọi tool gì như
// 01-manual-graph.js) - muốn xem chi tiết từng bước thì chạy file đó.
function printAnswer(result) {
  console.log(`\n>>> KẾT QUẢ CUỐI: ${result.messages.at(-1).content}\n`);
}

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!
`;

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  // agent: gộp sẵn cả graph (llm + action + điều kiện rẽ nhánh) - không cần tự viết
  // StateGraph/addNode/addConditionalEdges như agent.js.
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
  });

  console.log(
    "\n========== Câu 1: câu hỏi phổ thông - model tự trả lời, KHÔNG gọi tool ==========",
  );
  const result1 = await agent.invoke({
    messages: [{ role: "user", content: "What is the capital of Australia?" }],
  });
  printAnswer(result1);

  console.log(
    "\n========== Câu 2: câu hỏi ít phổ biến - model KHÔNG tự tin, phải gọi tool ==========",
  );
  const result2 = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "According to Wikipedia, what is the elevation in meters of Nauru's highest point?",
      },
    ],
  });
  printAnswer(result2);

  console.log("\n========== Câu 3: nhiều tool call cùng lúc ==========");
  const result3 = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "What is the capital of France, and what is the capital of Japan?",
      },
    ],
  });
  printAnswer(result3);

  console.log("\n========== Câu 4: nhiều bước suy luận nối tiếp nhau ==========");
  const query =
    "Who won the super bowl in 2024? In what state is the winning team headquarters " +
    "located? What is the GDP of that state? Answer each question.";
  const result4 = await agent.invoke({
    messages: [{ role: "user", content: query }],
  });
  printAnswer(result4);
}

main();
