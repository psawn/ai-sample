require("dotenv").config();

async function checkAvailableModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.models) {
      console.log("=== CÁC MÔ HÌNH GOOGLE ĐANG HỖ TRỢ ===");

      data.models.forEach((model) => {
        if (
          model.supportedGenerationMethods &&
          model.supportedGenerationMethods.includes("generateContent")
        ) {
          console.log(`- ${model.name.replace("models/", "")}`);
        }
      });
      console.log("=======================================");
    } else {
      console.log("Không lấy được danh sách:", data);
    }
  } catch (error) {
    console.error("Lỗi khi kiểm tra:", error);
  }
}

checkAvailableModels();
