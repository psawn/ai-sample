// =======================================================================
// GEMINI - CHATBOT ĐẶT VÉ MÁY BAY CÓ TOOL (FUNCTION CALLING)
//
// 1. Khai báo tool (tên + mô tả + tham số) cho model qua functionDeclarations.
// 2. Model không tự chạy tool, chỉ trả "yêu cầu gọi tool" + tham số.
// 3. Code chạy tool, gửi kết quả lại cho model, lặp tới khi model trả lời bằng text.
//
// MAX_TOOL_STEPS: giới hạn số vòng gọi tool trong 1 lượt, tránh model lặp vô hạn.
// Bản LangChain cùng ví dụ: ../langchain/10-functions-tools-agents/flight-booking-tool-calling.js.
// =======================================================================

require("dotenv").config();
const readline = require("readline");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-3.5-flash";
const today = new Date().toISOString().split('T')[0];
const SYSTEM_INSTRUCTION =
  `You are a helpful flight booking assistant. Help users look up flights and book tickets. Always answer in Vietnamese. Today's date is ${today}.`;
const MAX_TOOL_STEPS = 5;

// Chuyến bay giả lập. Key: điểm đến, viết thường, có dấu.
// "Da Nang" (không dấu) không khớp "đà nẵng" -> không tìm thấy.
// Mỗi điểm đến có nhiều chuyến với giờ khởi hành khác nhau trong ngày.
const MOCK_FLIGHTS = {
  "đà nẵng": [
    {
      flightNumber: "VN204",
      airline: "Vietnam Airlines",
      price: 1500000,
      duration: "1h20p",
      departureTime: "06:00",
    },
    {
      flightNumber: "VN206",
      airline: "Vietnam Airlines",
      price: 1650000,
      duration: "1h20p",
      departureTime: "12:30",
    },
    {
      flightNumber: "VJ640",
      airline: "VietJet Air",
      price: 1400000,
      duration: "1h15p",
      departureTime: "18:45",
    },
  ],
  "phú quốc": [
    {
      flightNumber: "VJ642",
      airline: "VietJet Air",
      price: 1800000,
      duration: "2h",
      departureTime: "07:15",
    },
    {
      flightNumber: "QH1142",
      airline: "Bamboo Airways",
      price: 1950000,
      duration: "2h05p",
      departureTime: "14:00",
    },
    {
      flightNumber: "VJ648",
      airline: "VietJet Air",
      price: 1700000,
      duration: "2h",
      departureTime: "20:30",
    },
  ],
  "nha trang": [
    {
      flightNumber: "QH301",
      airline: "Bamboo Airways",
      price: 1400000,
      duration: "1h10p",
      departureTime: "05:45",
    },
    {
      flightNumber: "VN360",
      airline: "Vietnam Airlines",
      price: 1550000,
      duration: "1h10p",
      departureTime: "11:20",
    },
    {
      flightNumber: "QH305",
      airline: "Bamboo Airways",
      price: 1350000,
      duration: "1h10p",
      departureTime: "19:00",
    },
  ],
  tokyo: [
    {
      flightNumber: "VN300",
      airline: "Vietnam Airlines",
      price: 12000000,
      duration: "5h30p",
      departureTime: "08:00",
    },
    {
      flightNumber: "VN302",
      airline: "Vietnam Airlines",
      price: 11500000,
      duration: "5h35p",
      departureTime: "23:10",
    },
  ],
  singapore: [
    {
      flightNumber: "VJ800",
      airline: "VietJet Air",
      price: 3500000,
      duration: "1h50p",
      departureTime: "09:30",
    },
    {
      flightNumber: "VJ802",
      airline: "VietJet Air",
      price: 3800000,
      duration: "1h50p",
      departureTime: "16:15",
    },
    {
      flightNumber: "TR802",
      airline: "Scoot",
      price: 3300000,
      duration: "1h55p",
      departureTime: "21:40",
    },
  ],
};

// Chuẩn hóa tên điểm đến để tra key: bỏ khoảng trắng thừa, viết thường.
function normalizeDestination(destination) {
  return String(destination).trim().toLowerCase();
}

// Giả lập tra cứu các chuyến bay theo điểm đến.
// Không tìm thấy -> trả found: false (không throw), để model đọc và báo lại cho user.
function getFlightInfo({ destination }) {
  const flights = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flights || flights.length === 0) {
    return {
      found: false,
      message: `Không tìm thấy chuyến bay tới "${destination}".`,
    };
  }
  return { found: true, destination, flights };
}

// Giả lập đặt vé tới điểm đến đã cho, trả mã đặt chỗ (bookingId).
// Không chỉ định flightNumber -> lấy chuyến đầu tiên trong ngày.
function bookFlight({ destination, date, passengerName, flightNumber }) {
  const flights = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flights || flights.length === 0) {
    return {
      success: false,
      message: `Không có chuyến bay tới "${destination}" để đặt.`,
    };
  }

  const flight = flightNumber
    ? flights.find(
        (f) => f.flightNumber.toLowerCase() === String(flightNumber).toLowerCase()
      )
    : flights[0];

  if (!flight) {
    return {
      success: false,
      message: `Không tìm thấy chuyến bay "${flightNumber}" tới "${destination}".`,
    };
  }

  return {
    success: true,
    bookingId: `BK${Date.now()}`,
    destination,
    date,
    passengerName,
    flightNumber: flight.flightNumber,
    airline: flight.airline,
    price: flight.price,
    departureTime: flight.departureTime,
  };
}

const genAI = new GoogleGenerativeAI(API_KEY);

// Khai báo tool cho model. Model đọc description để quyết định
// khi nào gọi tool nào -> description cần rõ ràng.
// name phải khớp key trong availableFunctions bên dưới.
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  systemInstruction: SYSTEM_INSTRUCTION,
  generationConfig: {
    temperature: 0.7,
  },
  tools: [
    {
      functionDeclarations: [
        {
          name: "getFlightInfo",
          description:
            "Tra cứu danh sách các chuyến bay (giả lập) theo địa điểm muốn đến, kèm giờ khởi hành khác nhau trong ngày.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              destination: {
                type: SchemaType.STRING,
                description: "Địa điểm muốn đến, ví dụ: Đà Nẵng, Tokyo.",
              },
            },
            required: ["destination"],
          },
        },
        {
          name: "bookFlight",
          description:
            "Đặt vé máy bay (giả lập) tới địa điểm đã cho. Nếu không chỉ định flightNumber, hệ thống sẽ chọn chuyến sớm nhất trong ngày.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              destination: {
                type: SchemaType.STRING,
                description: "Địa điểm muốn đến.",
              },
              date: {
                type: SchemaType.STRING,
                description: "Ngày khởi hành, định dạng YYYY-MM-DD.",
              },
              passengerName: {
                type: SchemaType.STRING,
                description: "Tên hành khách.",
              },
              flightNumber: {
                type: SchemaType.STRING,
                description:
                  "Số hiệu chuyến bay muốn đặt (lấy từ kết quả getFlightInfo), dùng khi có nhiều chuyến trong ngày ở các giờ khác nhau.",
              },
            },
            required: ["destination", "date", "passengerName"],
          },
        },
      ],
    },
  ],
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Tra hàm thực thi theo tên function model trả về.
const availableFunctions = {
  getFlightInfo,
  bookFlight,
};

// Lịch sử hội thoại, gồm cả các bước gọi tool và kết quả tool.
let history = [];

// Thêm 1 message text vào history.
function addMessage(role, text) {
  history.push({
    role,
    parts: [{ text }],
  });
}

// Vòng lặp tool calling:
// 1. Gửi history lên Gemini.
// 2. Model yêu cầu gọi tool -> chạy tool, gửi kết quả lại, quay về bước 1.
// 3. Model trả lời bằng text -> kết thúc.
// Hết MAX_TOOL_STEPS mà vẫn gọi tool -> throw.
async function askGemini() {
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const result = await model.generateContent({ contents: history });
    const calls = result.response.functionCalls();

    if (!calls || calls.length === 0) {
      console.log("Gemini không yêu cầu gọi tool.");
      return result.response.text();
    }

    // Lưu nguyên content của model (có functionCall) vào history.
    // Lưu nguyên, không dựng lại, để giữ các field ẩn Gemini cần ở lượt sau (vd thought_signature).
    history.push(result.response.candidates[0].content);

    // Chạy từng tool được yêu cầu (model có thể gọi nhiều tool 1 lúc), gom kết quả.
    // Tên tool không tồn tại -> trả object lỗi thay vì throw, để model tự xử lý.
    const toolResponses = calls.map((call) => {
      console.log(`🔧 Gọi tool: ${call.name}(${JSON.stringify(call.args)})`);

      const fn = availableFunctions[call.name];
      const output = fn
        ? fn(call.args)
        : { error: `Không tìm thấy tool "${call.name}"` };
      console.log(`   ↳ Kết quả "${call.name}":`, output);
      return { functionResponse: { name: call.name, response: output } };
    });

    // Kết quả tool gửi lại với role "user" (quy ước của Gemini, không có role "tool").
    history.push({ role: "user", parts: toolResponses });
  }

  throw new Error("Model gọi tool quá nhiều lần liên tiếp trong 1 lượt.");
}

// Vòng lặp chat: hỏi -> gọi model (có thể kèm tool) -> in kết quả -> hỏi tiếp.
function chat() {
  rl.question("\nBạn: ", async (input) => {
    if (input.trim().toLowerCase() === "exit") {
      console.log("\nTạm biệt!");
      rl.close();
      return;
    }

    // Nhớ độ dài history để rollback nếu lượt này lỗi.
    const historyLengthBeforeTurn = history.length;
    addMessage("user", input);

    try {
      console.log("Gemini đang suy nghĩ...\n");

      const answer = await askGemini();

      console.log("Gemini:", answer);

      addMessage("model", answer);
    } catch (error) {
      console.error("Lỗi:", error.message ?? error);

      // Bỏ hết message đã thêm trong lượt lỗi (user + các bước tool dở dang).
      // Không rollback -> history có functionCall thiếu functionResponse -> lượt sau lỗi tiếp.
      history = history.slice(0, historyLengthBeforeTurn);
    }

    chat();
  });
}

console.log("===== Gemini Chatbot with Tools =====");
console.log("Gõ 'exit' để thoát.");

chat();
