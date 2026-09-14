// =======================================================
// Function Calling: cho phép LLM tự quyết định có cần gọi 1 hàm bên ngoài
// (tool) hay không, thay vì tự bịa câu trả lời. Nếu cần, LLM sẽ trả về
// đúng tên hàm và tham số dạng JSON để code gọi hàm đó giúp nó.
//
// Các bước xử lý:
// 1. Khai báo trước danh sách tool mà LLM được phép dùng.
// 2. Gửi câu hỏi kèm danh sách tool đó cho LLM.
// 3. LLM trả về tool_calls (tên hàm + tham số) thay vì tự chạy hàm.
// 4. Code JS đọc tool_calls đó và thực thi hàm thật.
// 5. (Tuỳ chọn) Gửi kết quả của hàm ngược lại cho LLM để nó tổng hợp
//    thành câu trả lời cuối cùng bằng ngôn ngữ tự nhiên.
//
// tool_choice: tham số điều khiển LLM có bắt buộc gọi tool hay không.
// - "auto" (mặc định): LLM tự quyết định có cần gọi tool hay không.
// - "none": cấm LLM gọi bất kỳ tool nào, kể cả khi câu hỏi cần tool.
// - "<tên tool>": ép LLM luôn gọi đúng tool đó, bất kể câu hỏi là gì.
// =======================================================
require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Hàm giả lập lấy thời tiết - trong thực tế đây có thể là API backend hoặc
// API bên thứ 3. LLM không tự chạy được hàm này, nó chỉ chọn "nên gọi hàm nào,
// tham số gì", việc thực thi thật sự vẫn do code JS đảm nhiệm.
function getCurrentWeather(location, unit = "fahrenheit") {
  return JSON.stringify({
    location,
    temperature: "72",
    unit,
    forecast: ["sunny", "windy"],
  });
}

// Khai báo tool cho LLM dưới dạng JSON Schema chuẩn (Function Calling)
// Lưu ý: LLM chỉ đọc mô tả này để quyết định xem "có nên gọi hàm không"
// và "truyền tham số gì", việc thực thi thực tế vẫn do code đảm nhiệm
// Note: nếu muốn code an toàn (vừa mô tả cho AI, vừa validate kiểu dữ liệu),
// có thể dùng Zod + `zodToJsonSchema` (xem ../12-agents/03-custom-tool-tool-calling.js).
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

// Gửi câu hỏi cho LLM để kiểm tra quyết định gọi tool (xem có cần gọi không,
// gọi tool nào và tham số gì). Ở đây chỉ dừng lại ở việc nhận yêu cầu từ LLM,
// chưa thực thi tool và chưa gửi kết quả trả ngược lại.
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

// Tham khảo: nếu muốn tái sử dụng câu hỏi này với nhiều thành phố khác nhau,
// có thể thay new HumanMessage(...) bằng ChatPromptTemplate - 1 KHUÔN prompt
// có chỗ trống ({city}), điền biến vào lúc gọi .formatMessages() thay vì viết
// chết nội dung như HumanMessage:
//
//   const { ChatPromptTemplate } = require("@langchain/core/prompts");
//   const weatherPrompt = ChatPromptTemplate.fromMessages([
//     ["human", "What's the weather like in {city}!"],
//   ]);
//   const messages = await weatherPrompt.formatMessages({ city: "Boston" });
//
// Khác nhau giữa HumanMessage và ChatPromptTemplate.fromMessages:
// - new HumanMessage("..."): tạo thẳng 1 message với nội dung cố định,
//   dùng 1 lần cho đúng câu đó.
// - ChatPromptTemplate.fromMessages([...]): tạo 1 khuôn có biến, dùng lại
//   được nhiều lần với giá trị khác nhau - gọi .formatMessages({ city })
//   thì mới ra message thật (kết quả cũng là 1 HumanMessage như cách viết tay).

// Vòng lặp tool calling đầy đủ:
// 1. LLM chọn tool cần gọi.
// 2. Code JS thực thi tool thật.
// 3. Gửi kết quả đó ngược lại cho LLM.
// 4. LLM tổng hợp câu trả lời cuối cùng.
async function fullRoundTrip() {
  const messages = [new HumanMessage("What's the weather like in Boston!")];

  // Bước 1: hỏi LLM, ép nó phải gọi tool thời tiết.
  const firstResponse = await model.invoke(messages, {
    tools,
    tool_choice: "get_current_weather",
  });
  messages.push(firstResponse);

  // Bước 2: lấy tham số LLM đưa ra và thực thi hàm thật.
  const [toolCall] = firstResponse.tool_calls;
  const observation = getCurrentWeather(
    toolCall.args.location,
    toolCall.args.unit,
  );

  // Bước 3: đóng gói kết quả thành ToolMessage rồi thêm vào lịch sử hội thoại.
  messages.push(
    new ToolMessage({
      content: observation,
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }),
  );

  console.log("\n=== 7. Round-trip đầy đủ: gọi tool xong rồi hỏi lại LLM ===");
  try {
    // Bước 4: gọi lại LLM kèm lịch sử hội thoại (có cả ToolMessage) để nó
    // tổng hợp thành câu trả lời cuối cùng bằng ngôn ngữ tự nhiên.
    //
    // Có thể gặp lỗi 400 "missing thought_signature" ở đây:
    // - thought_signature là 1 token Gemini gắn vào mỗi lần model gọi tool,
    //   đại diện cho suy luận nội bộ dẫn tới lần gọi đó. Lượt hỏi tiếp theo
    //   phải gửi lại đúng token này kèm function call cũ, thiếu là bị chặn.
    // - Vì sao lỗi: @langchain/google-genai (bản đang dùng) build lại
    //   request chỉ từ name + args của tool_calls, không giữ thought_signature
    //   -> lỗi thư viện, không phải lỗi logic round-trip ở đây (gặp tương tự
    //   ở ../12-agents/03-custom-tool-tool-calling.js).
    // - Cách né: đổi sang model không yêu cầu field này (vd gemini-2.5-flash),
    //   hoặc dùng thẳng SDK @google/generative-ai thay vì LangChain cho đoạn
    //   round-trip này (xem ../../gemini/chat-bot-with-tool.js - không dính lỗi vì
    //   giữ nguyên content gốc thay vì dựng lại tool_calls).
    const finalResponse = await model.invoke(messages);
    console.log("Câu trả lời cuối cùng:", finalResponse.content);
  } catch (error) {
    console.log("Lỗi khi gọi lại LLM với lịch sử tool call:", error.message);
  }
}

async function main() {
  // 1. Câu hỏi cần tool, tool_choice mặc định (auto) -> LLM tự chọn gọi tool.
  await ask(
    "1. Hỏi thời tiết (tool_choice mặc định)",
    "What's the weather like in Boston?",
  );

  // 2. Câu hỏi không liên quan -> LLM không gọi tool nào.
  await ask("2. Câu hỏi không liên quan tool", "hi!");

  // 3. Giống trên nhưng ép tool_choice = "auto" tường minh -> kết quả tương tự.
  await ask(
    "3. Câu hỏi không liên quan, ép tool_choice = 'auto'",
    "hi!",
    "auto",
  );

  // 4. tool_choice = "none" -> LLM bị cấm gọi tool, dù câu hỏi không cần tool.
  await ask(
    "4. tool_choice = 'none' với câu hỏi không cần tool",
    "hi!",
    "none",
  );

  // 5. Câu hỏi cần tool nhưng tool_choice = "none" -> LLM buộc phải trả lời
  // bằng chữ, dù không có dữ liệu thời tiết thật.
  await ask(
    "5. Câu hỏi cần tool nhưng tool_choice = 'none'",
    "What's the weather in Boston?",
    "none",
  );

  // 6. Ép LLM luôn gọi đúng tool "get_current_weather", kể cả khi câu hỏi
  // ("hi!") không liên quan gì đến thời tiết.
  await ask(
    "6. Ép buộc gọi 1 tool cụ thể (tool_choice = tên tool)",
    "hi!",
    "get_current_weather",
  );

  // 7. Chạy full vòng lặp thực tế: gọi tool thật rồi đưa kết quả về cho LLM.
  await fullRoundTrip();
}

main();
