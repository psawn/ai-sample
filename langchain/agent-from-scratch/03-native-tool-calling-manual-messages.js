// Native Tool Calling (cách viết MỚI)
//
// Giải lại đúng bài toán ở agent.js/02-react-auto-loop.js (tính tổng cân nặng 2 con chó),
// nhưng bằng Native Tool Calling thay vì ReAct.
//
// Khác biệt so với ReAct:
// - Không cần system prompt dạy model viết đúng cú pháp "Action: ...".
// - Không cần regex tự đọc text để tìm Action.
// - Model trả thẳng "tool_calls": mảng { name, args } có cấu trúc rõ ràng.
// - Không cần tắt thinking (thinkingConfig) như agent.js - Native Tool Calling hoạt động
//   tốt dù thinking bật hay tắt.
//
// Cùng bài toán này còn 1 file khác cũng dùng Native Tool Calling nhưng dựng message ban
// đầu bằng ChatPromptTemplate thay vì viết tay - xem
// 04-native-tool-calling-prompt-template.js.
require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { calculate, averageDogWeight } = require("./actions");

// Bọc lại 2 hàm xử lý ở actions.js thành Tool chuẩn - chỉ thêm name/description/schema,
// KHÔNG viết lại logic bên trong (logic thật vẫn nằm ở actions.js).
const calculateTool = tool(({ expression }) => String(calculate(expression)), {
  name: "calculate",
  description: "Runs a basic arithmetic calculation, e.g. '37 + 20'.",
  schema: z.object({
    expression: z
      .string()
      .describe("The expression to evaluate, using JavaScript syntax"),
  }),
});

const averageDogWeightTool = tool(({ breed }) => averageDogWeight(breed), {
  name: "average_dog_weight",
  description: "Looks up the average weight of a dog breed.",
  schema: z.object({
    breed: z.string().describe("The dog breed, e.g. 'Border Collie'"),
  }),
});

const tools = [calculateTool, averageDogWeightTool];
const toolsByName = {
  calculate: calculateTool,
  average_dog_weight: averageDogWeightTool,
};

// llm.bindTools(tools): gắn danh sách Tool vào model, để model biết có gì để gọi và tự
// quyết định khi nào cần gọi. Không set thinkingConfig - để thinking bật như mặc định.
//
// Đây là cách "tự lái": bindTools() chỉ trả về model, còn đọc tool_calls, chạy tool, lặp
// lại (vòng for bên dưới) đều tự viết tay - để thấy rõ từng bước agent đang làm gì.
// LangChain còn có cách gọn hơn: createToolCallingAgent({ llm, tools, prompt }) kết hợp
// với AgentExecutor - 2 thứ này tự động hoá luôn cả vòng lặp, chỉ cần gọi
// agentExecutor.invoke({ input }) 1 lần là xong, không cần viết for loop nào (xem
// ../tool-routing/06-agent-executor.js). Code sản phẩm thật nên cân nhắc dùng cách đó cho
// gọn; ở đây dùng bindTools() vì mục đích là HỌC cơ chế, không phải tối ưu số dòng code.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});
const llmWithTools = llm.bindTools(tools);

// In ra toàn bộ mảng messages sắp gửi cho LLM, cho dễ hình dung agent đang "nhớ" những gì -
// so sánh với logMessages() ở agent.js để thấy điểm khác: ở đây messages còn có cả
// ToolMessage (kết quả gọi tool), không chỉ Human/AI/System như bên ReAct.
function logMessages(messages) {
  console.log("\n----- Messages gửi cho LLM -----");
  console.log(messages);
  console.log("---------------------------------");
}

// Vòng lặp Agent bằng Native Tool Calling:
//   1. Gọi model.
//   2. Nếu model KHÔNG yêu cầu gọi Tool nào (tool_calls rỗng) -> đó là câu trả lời cuối.
//   3. Nếu CÓ yêu cầu gọi Tool -> chạy từng Tool, đưa kết quả vào lại messages.
//   4. Quay lại bước 1, tới khi có câu trả lời cuối hoặc hết maxTurns.
async function query(question, maxTurns = 5) {
  // Tự tay dựng message ban đầu bằng new SystemMessage()/new HumanMessage().
  // Cùng bài toán này còn 1 cách viết khác, dùng ChatPromptTemplate để dựng 2 message
  // này - xem 04-native-tool-calling-prompt-template.js.
  const messages = [
    new SystemMessage("You are a helpful assistant."),
    new HumanMessage(question),
  ];

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);
    logMessages(messages);

    const aiMessage = await llmWithTools.invoke(messages);
    console.log("aiMessage:", aiMessage);

    messages.push(aiMessage);

    // Không có tool_calls -> model không yêu cầu gọi Tool nào nữa -> đây là câu trả lời cuối.
    const isFinished =
      !aiMessage.tool_calls || aiMessage.tool_calls.length === 0;

    if (isFinished) {
      console.log("Answer:", aiMessage.content);
      return aiMessage.content;
    }

    // Model có thể yêu cầu gọi nhiều Tool cùng lúc trong 1 turn -> chạy hết từng cái.
    for (const call of aiMessage.tool_calls) {
      console.log(`Đang gọi tool: ${call.name}(${JSON.stringify(call.args)})`);

      // tool.invoke(call): truyền thẳng cả object tool_call (có id) thay vì chỉ truyền
      // args - cách này trả về sẵn 1 ToolMessage đúng chuẩn (kèm tool_call_id), chỉ việc
      // push vào messages mà không cần tự dựng ToolMessage bằng tay.
      const toolMessage = await toolsByName[call.name].invoke(call);
      console.log("-> Kết quả:", toolMessage.content);
      messages.push(toolMessage);
    }
  }
}

async function main() {
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
