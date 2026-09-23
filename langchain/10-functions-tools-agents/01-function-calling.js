// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BƯỚC 1: FUNCTION CALLING
//
// LLM tự quyết định có cần gọi hàm bên ngoài (tool) không, thay vì tự bịa.
// Cần -> LLM trả tên hàm + tham số (JSON). Code chạy hàm, không phải LLM.
//
// Flow:
// 1. Khai báo danh sách tool LLM được dùng.
// 2. Gửi câu hỏi kèm danh sách tool.
// 3. LLM trả tool_calls (tên hàm + tham số), không tự chạy hàm.
// 4. Code đọc tool_calls, chạy hàm thật.
// 5. (Tùy chọn) Gửi kết quả lại cho LLM để viết câu trả lời cuối.
//
// tool_choice: điều khiển việc gọi tool.
// - "auto" (mặc định): LLM tự quyết định.
// - "none": cấm gọi tool, kể cả khi câu hỏi cần tool.
// - "<tên tool>": luôn gọi đúng tool đó, bất kể câu hỏi.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Hàm giả lập lấy thời tiết. Thực tế có thể là API backend / bên thứ 3.
function getCurrentWeather(location, unit = "fahrenheit") {
  return JSON.stringify({
    location,
    temperature: "72",
    unit,
    forecast: ["sunny", "windy"],
  });
}

// Khai báo tool bằng JSON Schema.
// LLM đọc để quyết định: có gọi hàm không, truyền tham số gì.
// Muốn vừa mô tả cho LLM vừa kiểm tra kiểu dữ liệu -> dùng Zod
// (xem util-zod-to-tool.js và ../12-agents/03-custom-tool-tool-calling.js).
const tools = [
  {
    type: "function",
    function: {
      name: "get_current_weather",
      description: "Get the current weather in a given location",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    },
  },
];

// Hỏi LLM, in quyết định gọi tool: có gọi không, tool nào, tham số gì.
// Chỉ xem quyết định, không chạy tool, không gửi kết quả lại.
async function ask(label, question, toolChoice) {
  const messages = [new HumanMessage(question)];
  const callOptions = toolChoice
    ? { tools, tool_choice: toolChoice }
    : { tools };

  const response = await model.invoke(messages, callOptions);

  console.log(`\n=== ${label} ===`);
  console.log("content:", response.content || "(rỗng)");
  console.log("tool_calls:", response.tool_calls);

  return response;
}

// Tham khảo: hỏi nhiều thành phố -> thay HumanMessage bằng ChatPromptTemplate
// (khuôn có chỗ trống {city}):
//
//   const { ChatPromptTemplate } = require("@langchain/core/prompts");
//   const weatherPrompt = ChatPromptTemplate.fromMessages([
//     ["human", "What's the weather like in {city}!"],
//   ]);
//   const messages = await weatherPrompt.formatMessages({ city: "Boston" });
//
// Khác nhau:
// - new HumanMessage("..."): 1 message cố định, dùng 1 lần.
// - ChatPromptTemplate: khuôn có biến, dùng lại nhiều lần.
//   .formatMessages({ city }) mới ra message thật (cũng là HumanMessage).

// Vòng tool calling đầy đủ (round-trip):
// 1. LLM chọn tool.
// 2. Code chạy tool.
// 3. Gửi kết quả lại cho LLM.
// 4. LLM viết câu trả lời cuối.
async function fullRoundTrip() {
  const messages = [new HumanMessage("What's the weather like in Boston!")];

  // Bước 1: hỏi LLM, ép gọi tool thời tiết.
  const firstResponse = await model.invoke(messages, {
    tools,
    tool_choice: "get_current_weather",
  });
  messages.push(firstResponse);

  // Bước 2: lấy tham số LLM chọn, chạy hàm.
  const [toolCall] = firstResponse.tool_calls;
  const observation = getCurrentWeather(
    toolCall.args.location,
    toolCall.args.unit,
  );

  // Bước 3: gói kết quả thành ToolMessage, thêm vào lịch sử.
  // tool_call_id: nối kết quả với đúng lượt gọi tool của LLM.
  messages.push(
    new ToolMessage({
      content: observation,
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }),
  );

  console.log("\n=== 7. Round-trip đầy đủ: gọi tool xong rồi hỏi lại LLM ===");
  try {
    // Bước 4: gọi lại LLM kèm lịch sử (có ToolMessage) để viết câu trả lời cuối.
    //
    // Lưu ý: có thể gặp lỗi 400 "missing thought_signature".
    // - thought_signature: token Gemini gắn vào mỗi lần gọi tool. Lượt sau phải
    //   gửi lại đúng token này kèm function call cũ, thiếu là bị chặn.
    // - Nguyên nhân: @langchain/google-genai dựng lại request chỉ từ name + args,
    //   làm mất thought_signature. Lỗi thư viện, không phải lỗi logic ở đây.
    //   (Gặp tương tự ở ../12-agents/03-custom-tool-tool-calling.js.)
    // - Cách né: dùng model không yêu cầu field này (vd gemini-2.5-flash),
    //   hoặc dùng thẳng SDK @google/generative-ai (xem ../../gemini/chat-bot-with-tool.js).
    const finalResponse = await model.invoke(messages);
    console.log("Câu trả lời cuối cùng:", finalResponse.content);
  } catch (error) {
    console.log("Lỗi khi gọi lại LLM với lịch sử tool call:", error.message);
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Case 1: câu hỏi cần tool, tool_choice mặc định (auto) -> LLM gọi tool.
  await ask(
    "1. Hỏi thời tiết (tool_choice mặc định)",
    "What's the weather like in Boston?",
  );

  // Case 2: câu hỏi không liên quan -> LLM không gọi tool.
  await ask("2. Câu hỏi không liên quan tool", "hi!");

  // Case 3: giống case 2, ghi rõ tool_choice = "auto" -> kết quả như nhau.
  await ask(
    "3. Câu hỏi không liên quan, ép tool_choice = 'auto'",
    "hi!",
    "auto",
  );

  // Case 4: tool_choice = "none", câu hỏi không cần tool -> LLM trả lời bằng chữ.
  await ask(
    "4. tool_choice = 'none' với câu hỏi không cần tool",
    "hi!",
    "none",
  );

  // Case 5: câu hỏi cần tool nhưng tool_choice = "none"
  // -> LLM buộc trả lời bằng chữ, dù không có dữ liệu thời tiết thật.
  await ask(
    "5. Câu hỏi cần tool nhưng tool_choice = 'none'",
    "What's the weather in Boston?",
    "none",
  );

  // Case 6: ép gọi "get_current_weather", dù câu hỏi ("hi!") không liên quan.
  await ask(
    "6. Ép buộc gọi 1 tool cụ thể (tool_choice = tên tool)",
    "hi!",
    "get_current_weather",
  );

  // Case 7: chạy đủ vòng: gọi tool -> đưa kết quả về LLM.
  await fullRoundTrip();
}

main();
