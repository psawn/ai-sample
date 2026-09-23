// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BÀI TẬP: FUNCTION CALLING ĐẶT VÉ MÁY BAY
//
// Bản "đặt vé máy bay" của 01-function-calling.js: giữ cấu trúc demo,
// đổi tool và dữ liệu. Điểm mới: 2 tool phối hợp với nhau.
// - get_flight_info: tra cứu chuyến bay.
// - book_flight: đặt vé.
//
// Flow fullRoundTrip():
// 1. LLM tra cứu chuyến bay.
// 2. Dựa vào kết quả, LLM tự quyết định có đặt vé không.
// 3. LLM viết câu trả lời cuối.
//
// Các bước function calling và tool_choice: xem 01-function-calling.js.
// =======================================================================

require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// ===== DỮ LIỆU & HÀM GIẢ LẬP =====

// Chuyến bay giả lập. Key: điểm đến, viết thường.
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

// Chuẩn hóa tên điểm đến để tra MOCK_FLIGHTS. Vd: "  Đà Nẵng " -> "đà nẵng".
function normalizeDestination(destination) {
  return String(destination).trim().toLowerCase();
}

// Giả lập tra cứu chuyến bay. Thực tế có thể là API backend / bên thứ 3.
// Không tìm thấy -> trả found: false (không throw), để LLM đọc và báo lại cho user.
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

// Giả lập đặt vé, trả mã đặt chỗ (bookingId).
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

// ===== KHAI BÁO TOOL CHO LLM =====

// Khai báo tool bằng JSON Schema.
// LLM đọc để quyết định: có gọi hàm không, truyền tham số gì.
// Muốn vừa mô tả cho LLM vừa kiểm tra kiểu dữ liệu -> dùng Zod
// (xem util-zod-to-tool.js và ../12-agents/03-custom-tool-tool-calling.js).
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

// Tham khảo: hỏi nhiều điểm đến -> thay HumanMessage bằng ChatPromptTemplate:
//
//   const { ChatPromptTemplate } = require("@langchain/core/prompts");
//   const flightPrompt = ChatPromptTemplate.fromMessages([
//     ["human", "Chuyến bay tới {city} thế nào?"],
//   ]);
//   const messages = await flightPrompt.formatMessages({ city: "Đà Nẵng" });
//
// So sánh HumanMessage vs ChatPromptTemplate: xem 01-function-calling.js.

// Vòng tool calling đầy đủ, 2 tool phối hợp:
// 1. LLM tra cứu chuyến bay (get_flight_info).
// 2. Dựa vào kết quả, LLM tự quyết định có đặt vé không (book_flight).
// 3. LLM viết câu trả lời cuối.
async function fullRoundTrip() {
  const messages = [
    new HumanMessage(
      "Tôi muốn đặt vé máy bay tới Đà Nẵng vào ngày 2026-10-01, tên hành khách Nguyễn Văn A. Trước tiên hãy tra cứu thông tin chuyến bay.",
    ),
  ];

  console.log("\n=== 7. Round-trip đầy đủ: tra cứu chuyến bay rồi đặt vé ===");

  // Bước 1: hỏi LLM, ép tra cứu chuyến bay trước.
  const firstResponse = await model.invoke(messages, {
    tools,
    tool_choice: "get_flight_info",
  });
  messages.push(firstResponse);

  // Bước 2: lấy tham số LLM chọn, chạy hàm.
  const [infoCall] = firstResponse.tool_calls;
  const infoResult = getFlightInfo(infoCall.args.destination);

  // Bước 3: gói kết quả thành ToolMessage, thêm vào lịch sử.
  messages.push(
    new ToolMessage({
      content: infoResult,
      tool_call_id: infoCall.id,
      name: infoCall.name,
    }),
  );

  try {
    // Bước 4: gọi lại LLM kèm tools, không ép tool_choice
    // -> LLM tự quyết định có gọi book_flight không.
    //
    // Lưu ý: có thể gặp lỗi 400 "missing thought_signature" (ở đây và bước cuối).
    // Nguyên nhân + cách né: xem Bước 4 trong 01-function-calling.js.
    const secondResponse = await model.invoke(messages, { tools });
    messages.push(secondResponse);

    // LLM không gọi book_flight (vd: không có chuyến bay) -> in luôn câu trả lời.
    const [bookCall] = secondResponse.tool_calls ?? [];
    if (!bookCall) {
      console.log("Câu trả lời cuối cùng:", secondResponse.content);
      return;
    }

    // Bước 5: LLM gọi book_flight -> chạy hàm, gói kết quả,
    // hỏi LLM lần cuối để viết câu trả lời.
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

// ===== KỊCH BẢN MINH HỌA =====
// Case 1-6 đang tắt (giống 01-function-calling.js), bỏ comment để chạy.
async function main() {
  // Case 1: câu hỏi cần tool, tool_choice mặc định (auto) -> LLM tự gọi tool.
  // await ask(
  //   "1. Hỏi thông tin chuyến bay (tool_choice mặc định)",
  //   "Chuyến bay tới Đà Nẵng thế nào?",
  // );

  // // Case 2: câu hỏi không liên quan -> LLM không gọi tool.
  // await ask("2. Câu hỏi không liên quan tool", "hi!");

  // // Case 3: giống case 2, ghi rõ tool_choice = "auto" -> kết quả như nhau.
  // await ask(
  //   "3. Câu hỏi không liên quan, ép tool_choice = 'auto'",
  //   "hi!",
  //   "auto",
  // );

  // // Case 4: tool_choice = "none", câu hỏi không cần tool -> LLM trả lời bằng chữ.
  // await ask(
  //   "4. tool_choice = 'none' với câu hỏi không cần tool",
  //   "hi!",
  //   "none",
  // );

  // // Case 5: câu hỏi cần tool nhưng tool_choice = "none"
  // // -> LLM buộc trả lời bằng chữ, dù không có dữ liệu chuyến bay thật.
  // await ask(
  //   "5. Câu hỏi cần tool nhưng tool_choice = 'none'",
  //   "Chuyến bay tới Tokyo giá bao nhiêu?",
  //   "none",
  // );

  // // Case 6: ép gọi "get_flight_info", dù câu hỏi ("hi!") không liên quan.
  // await ask(
  //   "6. Ép buộc gọi 1 tool cụ thể (tool_choice = tên tool)",
  //   "hi!",
  //   "get_flight_info",
  // );

  // Case 7: chạy đủ vòng: tra cứu chuyến bay rồi đặt vé.
  await fullRoundTrip();
}

main();
