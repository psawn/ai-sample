// =======================================================================
// TOOL ROUTING - BƯỚC 5: ROUTING (CHỌN TOOL THEO CÂU HỎI)
//
// Model biết nhiều Tool cùng lúc, tự chọn Tool hợp với câu hỏi,
// hoặc trả lời thẳng nếu không cần Tool.
//
// Flow:
// 1. chain: prompt -> model -> AIMessage (có thể kèm tool_calls).
// 2. route(): đọc tool_calls, gọi đúng Tool.
// 3. Trả thẳng kết quả Tool cho user.
//
// Giới hạn: kết quả Tool không quay lại model, nên model không viết câu trả lời cuối.
// Vòng lặp đầy đủ (Tool -> model -> ...): 06-agent-executor.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { getCurrentTemperature } = require("./02-weather-tool");
const { searchWikipedia } = require("./03-wikipedia-tool");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Gắn 2 Tool vào model: tra Wikipedia + xem nhiệt độ.
const tools = [searchWikipedia, getCurrentTemperature];
const modelWithTools = llm.bindTools(tools);

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are helpful but sassy assistant"],
  ["human", "{input}"],
]);

// Chain: prompt -> model có Tool. Output là AIMessage, có thể kèm tool_calls.
const chain = prompt.pipe(modelWithTools);

// route(): đọc tool_calls để quyết định bước tiếp theo.
// - Không có tool_calls -> model đã trả lời thẳng -> trả content.
// - Có tool_calls -> tra Tool theo tên, gọi với tham số model chọn.
// Chỉ chạy tool_calls[0], bỏ qua các lượt gọi còn lại (nếu có).
async function route(aiMessage) {
  console.log("aiMessage:", aiMessage);

  if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
    return aiMessage.content;
  }

  const toolsByName = {
    search_wikipedia: searchWikipedia,
    get_current_temperature: getCurrentTemperature,
  };

  const call = aiMessage.tool_calls[0];
  const tool = toolsByName[call.name];
  console.log("gọi tool:", call.name, "với tham số:", call.args);

  // Chạy hàm của Tool, không gọi LLM.
  return tool.invoke(call.args);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  try {
    // Câu 1: hỏi thời tiết -> kỳ vọng get_current_temperature.
    const weatherAnswer = await chain.invoke({
      input: "What is the weather in san francisco right now?",
    });
    console.log("=== weather ===");
    console.log(await route(weatherAnswer));

    // Câu 2: hỏi kiến thức -> kỳ vọng search_wikipedia.
    // const langchainAnswer = await chain.invoke({ input: "What is langchain?" });
    // console.log("\n=== langchain ===");
    // console.log(await route(langchainAnswer));

    // Câu 3: chào hỏi -> kỳ vọng trả lời thẳng, không gọi Tool.
    // const greeting = await chain.invoke({ input: "hi!" });
    // console.log("\n=== hi! ===");
    // console.log(await route(greeting));
  } catch (error) {
    console.error(error);
  }
}

main();
