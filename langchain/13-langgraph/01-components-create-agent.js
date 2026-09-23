// =======================================================================
// LANGGRAPH - BƯỚC 1: COMPONENTS (BẢN createAgent)
//
// Agent nghiên cứu: trả lời câu hỏi, cần thì gọi tool web_search để tra cứu.
// createAgent tự dựng graph bên trong (node, edge, vòng lặp) -> code gọn, hợp cho dự án thật.
//
// Cùng bài toán với 01-components-manual-graph.js.
// Bản đó tự dựng graph bằng StateGraph, xem để hiểu graph chạy bên trong thế nào.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

// In câu trả lời cuối (message cuối của Model).
// createAgent không log từng node, nên không thấy từng bước gọi tool như bản manual.
function printAnswer(result) {
  console.log(`\n>>> KẾT QUẢ CUỐI: ${result.messages.at(-1).content}\n`);
}

// System prompt: trợ lý nghiên cứu, được gọi tool nhiều lần (song song hoặc nối tiếp).
const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!
`;

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  // Gộp Model + tools + system prompt thành 1 graph hoàn chỉnh.
  // Không cần StateGraph, addNode, addConditionalEdges.
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
  });

  // Câu 1: kiến thức phổ thông -> Model tự trả lời, không gọi tool.
  console.log(
    "\n========== Câu 1: Câu hỏi phổ thông - Model tự trả lời ngay, KHÔNG gọi Tool ==========",
  );
  const result1 = await agent.invoke({
    messages: [{ role: "user", content: "What is the capital of Australia?" }],
  });
  printAnswer(result1);

  // Câu 2: thông tin chi tiết, ít phổ biến -> Model gọi 1 tool.
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

  // Câu 3: 2 câu hỏi độc lập -> Model gọi nhiều tool cùng lúc.
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

  // Câu 4: câu sau cần kết quả câu trước -> Model tra cứu nối tiếp qua nhiều vòng.
  // Thứ tự: đội thắng -> bang của đội -> GDP của bang.
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