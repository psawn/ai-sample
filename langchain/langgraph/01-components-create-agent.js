// LangGraph Components - Bản dùng createAgent (API cấp cao, khuyến nghị cho Production)
// Mục tiêu:
//   - Giải quyết cùng bài toán với 01-components-manual-graph.js nhưng không cần tự dựng
//     StateGraph.
//   - `createAgent` tự động dựng toàn bộ Graph (Node, Edge, Loop) bên trong, giúp tối giản code.
// Lưu ý:
//   Muốn xem rõ cơ chế Graph hoạt động bên trong thế nào thì xem bản manual ở
//   01-components-manual-graph.js.

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

// In ra tin nhắn cuối cùng (câu trả lời từ Model).
// Lưu ý: createAgent đã ẩn toàn bộ log trung gian của từng Node (không xem được từng bước gọi tool như ở file 01).
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

  // createAgent: Tự động gộp Model + Tools + System Prompt thành 1 Graph hoàn chỉnh.
  // Không cần khai báo StateGraph, addNode hay addConditionalEdges thủ công.
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
  });

  console.log(
    "\n========== Câu 1: Câu hỏi phổ thông - Model tự trả lời ngay, KHÔNG gọi Tool ==========",
  );
  const result1 = await agent.invoke({
    messages: [{ role: "user", content: "What is the capital of Australia?" }],
  });
  printAnswer(result1);

  console.log(
    "\n========== Câu 2: Câu hỏi tra cứu chi tiết - Model cần gọi 1 Tool ==========",
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

  console.log("\n========== Câu 3: Câu hỏi song song - Model gọi nhiều Tool cùng lúc ==========");
  const result3 = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "What is the capital of France, and what is the capital of Japan?",
      },
    ],
  });
  printAnswer(result3);

  console.log("\n========== Câu 4: Câu hỏi chuỗi - Model chạy vòng lặp tra cứu qua nhiều bước ==========");
  const query =
    "Who won the super bowl in 2024? In what state is the winning team headquarters " +
    "located? What is the GDP of that state? Answer each question.";
  const result4 = await agent.invoke({
    messages: [{ role: "user", content: query }],
  });
  printAnswer(result4);
}

main();