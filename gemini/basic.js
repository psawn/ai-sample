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

    const response = result.response;
    const text = response.text();

    console.log("Phản hồi từ Gemini:", text);
  } catch (error) {
    console.error("Lỗi khi gọi Google Gemini API:", error);
  }
}

runGemini();
