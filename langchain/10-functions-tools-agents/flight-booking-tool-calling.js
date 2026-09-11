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
//
// Bản này là phiên bản domain "đặt vé máy bay" của 01-function-calling.js
// (giữ nguyên cấu trúc demo, chỉ đổi tool/mock data), dùng 2 tool phối hợp:
// get_flight_info (tra cứu) và book_flight (đặt vé) để fullRoundTrip() demo
// được chuỗi "tra cứu rồi đặt vé".
// =======================================================
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Dữ liệu chuyến bay giả lập, key là địa điểm đến (viết thường).
const MOCK_FLIGHTS = {
  "đà nẵng": {
    flightNumber: "VN204",
    airline: "Vietnam Airlines",
    price: 1500000,
    duration: "1h20p",
  },
  "phú quốc": {
    flightNumber: "VJ642",
    airline: "VietJet Air",
    price: 1800000,
    duration: "2h",
  },
  "nha trang": {
    flightNumber: "QH301",
    airline: "Bamboo Airways",
    price: 1400000,
    duration: "1h10p",
  },
  tokyo: {
    flightNumber: "VN300",
    airline: "Vietnam Airlines",
    price: 12000000,
    duration: "5h30p",
  },
  singapore: {
    flightNumber: "VJ800",
    airline: "VietJet Air",
    price: 3500000,
    duration: "1h50p",
  },
};

function normalizeDestination(destination) {
  return String(destination).trim().toLowerCase();
}

// Hàm giả lập tra cứu chuyến bay - trong thực tế đây có thể là API backend/API
// bên thứ 3. LLM không tự chạy được hàm này, nó chỉ chọn "nên gọi hàm nào,
// tham số gì", việc thực thi thật sự vẫn do code JS đảm nhiệm.
function getFlightInfo(destination) {
  const flight = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flight) {
    return JSON.stringify({
      found: false,
      message: `Không tìm thấy chuyến bay tới "${destination}".`,
    });
  }
  return JSON.stringify({ found: true, destination, ...flight });
}

// Hàm giả lập đặt vé máy bay tới địa điểm đã cho.
function bookFlight(destination, date, passengerName) {
  const flight = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flight) {
    return JSON.stringify({
      success: false,
      message: `Không có chuyến bay tới "${destination}" để đặt.`,
    });
  }
  return JSON.stringify({
    success: true,
    bookingId: `BK${Date.now()}`,
    destination,
    date,
    passengerName,
    flightNumber: flight.flightNumber,
    airline: flight.airline,
    price: flight.price,
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
      name: "get_flight_info",
      description: "Tra cứu thông tin chuyến bay (giả lập) theo địa điểm muốn đến",
      parameters: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "Địa điểm muốn đến, ví dụ: Đà Nẵng, Tokyo",
          },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_flight",
      description: "Đặt vé máy bay (giả lập) tới địa điểm đã cho",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Địa điểm muốn đến" },
          date: {
            type: "string",
            description: "Ngày khởi hành, định dạng YYYY-MM-DD",
          },
          passengerName: { type: "string", description: "Tên hành khách" },
        },
        required: ["destination", "date", "passengerName"],
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

// Tham khảo: nếu muốn tái sử dụng câu hỏi này với nhiều địa điểm khác nhau,
// có thể thay new HumanMessage(...) bằng ChatPromptTemplate - 1 KHUÔN prompt
// có chỗ trống ({city}), điền biến vào lúc gọi .formatMessages() thay vì viết
// chết nội dung như HumanMessage:
//
//   const { ChatPromptTemplate } = require("@langchain/core/prompts");
//   const flightPrompt = ChatPromptTemplate.fromMessages([
//     ["human", "Chuyến bay tới {city} thế nào?"],
//   ]);
//   const messages = await flightPrompt.formatMessages({ city: "Đà Nẵng" });
//
// Khác nhau giữa HumanMessage và ChatPromptTemplate.fromMessages:
// - new HumanMessage("..."): tạo thẳng 1 message với nội dung cố định,
//   dùng 1 lần cho đúng câu đó.
// - ChatPromptTemplate.fromMessages([...]): tạo 1 khuôn có biến, dùng lại
//   được nhiều lần với giá trị khác nhau - gọi .formatMessages({ city })
//   thì mới ra message thật (kết quả cũng là 1 HumanMessage như cách viết tay).

// Vòng lặp tool calling đầy đủ, demo chuỗi 2 tool phối hợp:
// 1. LLM tra cứu thông tin chuyến bay (get_flight_info).
// 2. Dựa trên kết quả tra cứu, LLM tự quyết định có đặt vé tiếp không
//    (book_flight).
// 3. LLM tổng hợp câu trả lời cuối cùng.
async function fullRoundTrip() {
  const messages = [
    new HumanMessage(
      "Tôi muốn đặt vé máy bay tới Đà Nẵng vào ngày 2026-10-01, tên hành khách Nguyễn Văn A. Trước tiên hãy tra cứu thông tin chuyến bay.",
    ),
  ];

  console.log("\n=== 7. Round-trip đầy đủ: tra cứu chuyến bay rồi đặt vé ===");

  // Bước 1: hỏi LLM, ép nó phải tra cứu thông tin chuyến bay trước.
  const firstResponse = await model.invoke(messages, {
    tools,
    tool_choice: "get_flight_info",
  });
  messages.push(firstResponse);

  // Bước 2: lấy tham số LLM đưa ra và thực thi hàm thật.
  const [infoCall] = firstResponse.tool_calls;
  const infoResult = getFlightInfo(infoCall.args.destination);

  // Bước 3: đóng gói kết quả thành ToolMessage rồi thêm vào lịch sử hội thoại.
  messages.push(
    new ToolMessage({
      content: infoResult,
      tool_call_id: infoCall.id,
      name: infoCall.name,
    }),
  );

  try {
    // Bước 4: gọi lại LLM kèm tools (không ép tool_choice) để nó tự quyết
    // định có nên gọi tiếp book_flight hay không, dựa trên kết quả tra cứu.
    //
    // Có thể gặp lỗi 400 "missing thought_signature" ở đây (và ở bước cuối
    // nếu đi tiếp tới book_flight):
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
    const secondResponse = await model.invoke(messages, { tools });
    messages.push(secondResponse);

    const [bookCall] = secondResponse.tool_calls ?? [];
    if (!bookCall) {
      console.log("Câu trả lời cuối cùng:", secondResponse.content);
      return;
    }

    // Bước 5: LLM chọn gọi tiếp book_flight -> thực thi hàm thật, đóng gói
    // kết quả rồi hỏi lại LLM lần cuối để tổng hợp câu trả lời tự nhiên.
    const bookResult = bookFlight(
      bookCall.args.destination,
      bookCall.args.date,
      bookCall.args.passengerName,
    );
    messages.push(
      new ToolMessage({
        content: bookResult,
        tool_call_id: bookCall.id,
        name: bookCall.name,
      }),
    );

    const finalResponse = await model.invoke(messages);
    console.log("Câu trả lời cuối cùng:", finalResponse.content);
  } catch (error) {
    console.log("Lỗi khi gọi lại LLM với lịch sử tool call:", error.message);
  }
}

async function main() {
  // 1. Câu hỏi cần tool, tool_choice mặc định (auto) -> LLM tự chọn gọi tool.
  // await ask(
  //   "1. Hỏi thông tin chuyến bay (tool_choice mặc định)",
  //   "Chuyến bay tới Đà Nẵng thế nào?",
  // );

  // // 2. Câu hỏi không liên quan -> LLM không gọi tool nào.
  // await ask("2. Câu hỏi không liên quan tool", "hi!");

  // // 3. Giống trên nhưng ép tool_choice = "auto" tường minh -> kết quả tương tự.
  // await ask(
  //   "3. Câu hỏi không liên quan, ép tool_choice = 'auto'",
  //   "hi!",
  //   "auto",
  // );

  // // 4. tool_choice = "none" -> LLM bị cấm gọi tool, dù câu hỏi không cần tool.
  // await ask(
  //   "4. tool_choice = 'none' với câu hỏi không cần tool",
  //   "hi!",
  //   "none",
  // );

  // // 5. Câu hỏi cần tool nhưng tool_choice = "none" -> LLM buộc phải trả lời
  // // bằng chữ, dù không có dữ liệu chuyến bay thật.
  // await ask(
  //   "5. Câu hỏi cần tool nhưng tool_choice = 'none'",
  //   "Chuyến bay tới Tokyo giá bao nhiêu?",
  //   "none",
  // );

  // // 6. Ép LLM luôn gọi đúng tool "get_flight_info", kể cả khi câu hỏi
  // // ("hi!") không liên quan gì đến chuyến bay.
  // await ask(
  //   "6. Ép buộc gọi 1 tool cụ thể (tool_choice = tên tool)",
  //   "hi!",
  //   "get_flight_info",
  // );

  // 7. Chạy full vòng lặp thực tế: tra cứu chuyến bay rồi đặt vé.
  await fullRoundTrip();
}

main();
