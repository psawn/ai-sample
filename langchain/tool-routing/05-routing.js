// ROUTING: cho model biết nhiều Tool cùng lúc, để nó tự chọn Tool phù hợp với câu hỏi -
// hoặc trả lời thẳng nếu không cần Tool nào. route() đọc quyết định đó và gọi đúng Tool.
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

const tools = [searchWikipedia, getCurrentTemperature];
const modelWithTools = llm.bindTools(tools);

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are helpful but sassy assistant"],
  ["human", "{input}"],
]);

const chain = prompt.pipe(modelWithTools);

// route(): đọc aiMessage.tool_calls để quyết định bước tiếp theo.
// - Không có tool_calls -> model đã trả lời thẳng -> trả về content luôn.
// - Có tool_calls -> tra trong map "tools", gọi đúng Tool với đúng tham số model chọn.
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

  // tool.invoke(args): chạy thật hàm bên trong tool (vd: fetchCurrentTemperature) với
  // args model vừa chọn - không gọi LLM, chỉ chạy code local.
  return tool.invoke(call.args);
}

async function main() {
  try {
    const weatherAnswer = await chain.invoke({
      input: "What is the weather in san francisco right now?",
    });
    console.log("=== weather ===");
    console.log(await route(weatherAnswer));

    // const langchainAnswer = await chain.invoke({ input: "What is langchain?" });
    // console.log("\n=== langchain ===");
    // console.log(await route(langchainAnswer));

    // const greeting = await chain.invoke({ input: "hi!" });
    // console.log("\n=== hi! ===");
    // console.log(await route(greeting));
  } catch (error) {
    console.error(error);
  }
}

main();
