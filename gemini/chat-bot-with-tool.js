require("dotenv").config();
const readline = require("readline");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-3.5-flash";
const SYSTEM_INSTRUCTION =
  "You are a helpful flight booking assistant. Help users look up flights and book tickets. Always answer in Vietnamese.";
const MAX_TOOL_STEPS = 5;

// Dữ liệu chuyến bay giả lập, key là địa điểm đến (viết thường, không dấu cách thừa).
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

// Giả lập tra cứu thông tin chuyến bay theo địa điểm đến.
function getFlightInfo({ destination }) {
  const flight = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flight) {
    return {
      found: false,
      message: `Không tìm thấy chuyến bay tới "${destination}".`,
    };
  }
  return { found: true, destination, ...flight };
}

// Giả lập đặt vé máy bay tới địa điểm đã cho.
function bookFlight({ destination, date, passengerName }) {
  const flight = MOCK_FLIGHTS[normalizeDestination(destination)];
  if (!flight) {
    return {
      success: false,
      message: `Không có chuyến bay tới "${destination}" để đặt.`,
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
  };
}

const genAI = new GoogleGenerativeAI(API_KEY);

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
            "Tra cứu thông tin chuyến bay (giả lập) theo địa điểm muốn đến.",
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
          description: "Đặt vé máy bay (giả lập) tới địa điểm đã cho.",
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

// Map tên function trong functionDeclarations -> hàm thực thi tương ứng.
const availableFunctions = {
  getFlightInfo,
  bookFlight,
};

let history = [];

function addMessage(role, text) {
  history.push({
    role,
    parts: [{ text }],
  });
}

// Gửi history lên Gemini. Nếu model yêu cầu gọi tool, thực thi tool đó
// bằng availableFunctions, gửi kết quả lại cho model, rồi hỏi lại tới khi
// model trả lời bằng text (không còn yêu cầu gọi tool nào nữa).
async function askGemini() {
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const result = await model.generateContent({ contents: history });
    const calls = result.response.functionCalls();

    if (!calls || calls.length === 0) {
      console.log("Gemini không yêu cầu gọi tool.");
      return result.response.text();
    }

    // Lưu lại lượt gọi tool của model vào history.
    history.push(result.response.candidates[0].content);

    // Thực thi từng tool được yêu cầu, gom kết quả để gửi lại cho model.
    const toolResponses = calls.map((call) => {
      console.log(`🔧 Gọi tool: ${call.name}(${JSON.stringify(call.args)})`);

      const fn = availableFunctions[call.name];
      const output = fn
        ? fn(call.args)
        : { error: `Không tìm thấy tool "${call.name}"` };
      console.log(`   ↳ Kết quả "${call.name}":`, output);
      return { functionResponse: { name: call.name, response: output } };
    });

    history.push({ role: "user", parts: toolResponses });
  }

  throw new Error("Model gọi tool quá nhiều lần liên tiếp trong 1 lượt.");
}

function chat() {
  rl.question("\nBạn: ", async (input) => {
    if (input.trim().toLowerCase() === "exit") {
      console.log("\nTạm biệt!");
      rl.close();
      return;
    }

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
      history = history.slice(0, historyLengthBeforeTurn);
    }

    chat();
  });
}

console.log("===== Gemini Chatbot with Tools =====");
console.log("Gõ 'exit' để thoát.");

chat();
