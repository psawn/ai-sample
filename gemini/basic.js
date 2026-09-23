// =======================================================================
// GEMINI - GỌI MODEL CƠ BẢN & TRẢ VỀ JSON
//
// Dùng thẳng SDK @google/generative-ai, không qua LangChain.
// 1. systemInstruction: chỉ dẫn chung cho model (ở đây: trả lời bằng JSON).
// 2. responseMimeType: ép model trả đúng định dạng JSON.
// 3. generateContent: gửi prompt, đọc kết quả bằng response.text().
// =======================================================================

require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);

async function runGemini() {
  // Lưu ý: generationConfig khai báo 2 lần, key sau ghi đè key trước.
  // -> temperature: 2 bị mất, chỉ còn responseMimeType có hiệu lực.
  // Muốn giữ cả 2: gộp vào 1 object { temperature, responseMimeType }.
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: {
      temperature: 2,
    },
    systemInstruction: {
      role: "system",
      parts: [{ text: "You respond in JSON format" }],
    },
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  // const prompt = "Hãy đặt 1 cái tên bằng tiếng Việt cho một chú mèo màu đen";
  const prompt = "Cho tôi thông tin độ cao núi phú sĩ";
  console.log("Đang chờ Gemini phản hồi...");

  try {
    // Gemini không nhận role "system" trong contents (chỉ có "user" và "model").
    // System prompt phải đặt ở systemInstruction phía trên.
    const result = await model.generateContent({
      contents: [
        // {
        //   role: "system",
        //   parts: [{ text: "You respond in JSON format" }],
        // },
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    // text(): chuỗi JSON, chưa phải object. Cần JSON.parse(text) nếu muốn dùng field.
    const response = result.response;
    const text = response.text();

    console.log("Phản hồi từ Gemini:", text);
  } catch (error) {
    console.error("Lỗi khi gọi Google Gemini API:", error);
  }
}

runGemini();
