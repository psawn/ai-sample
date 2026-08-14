require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);

async function runGemini() {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: {
      temperature: 2,
    },
  });

  const prompt = "Hãy đặt 1 cái tên bằng tiếng Việt cho một chú mèo màu đen";
  console.log("Đang chờ Gemini phản hồi...");

  try {
    const result = await model.generateContent(prompt);

    const response = result.response;
    const text = response.text();

    console.log("Phản hồi từ Gemini:", text);
  } catch (error) {
    console.error("Lỗi khi gọi Google Gemini API:", error);
  }
}

runGemini();
