// =======================================================================
// VECTORSTORE - BƯỚC 1: EMBEDDING & ĐỘ GIỐNG NHAU
//
// 1. Embedding: đổi câu thành vector số.
// 2. Câu gần nghĩa -> vector gần nhau -> dot product cao.
//
// Vd: "dogs" và "canines" khác chữ nhưng cùng nghĩa -> điểm cao.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

// Dot product 2 vector: càng cao -> 2 câu càng gần nghĩa.
function dotProduct(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

// Model embedding: đổi câu thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const sentence1 = "i like dogs";
  const sentence2 = "i like canines";
  const sentence3 = "the weather is ugly outside";

  // embedDocuments: embed nhiều câu trong 1 lần gọi API, trả vector đúng thứ tự.
  // Nhanh hơn gọi embedQuery riêng cho từng câu.
  // Lưu ý: batch lỗi thì trả vector rỗng, không throw (xem ../06-retrieval/debug-embedding-errors.js).
  const [embedding1, embedding2, embedding3] = await embeddings.embedDocuments([
    sentence1,
    sentence2,
    sentence3,
  ]);

  console.log("embedding1", embedding1.slice(0, 10), "...");
  console.log("embedding2", embedding2.slice(0, 10), "...");
  console.log("embedding3", embedding3.slice(0, 10), "...");

  // Kỳ vọng: dogs vs canines cao hơn hẳn các cặp có "weather" (không liên quan).
  console.log("=== So sánh embedding ===");
  console.log("dogs vs canines:", dotProduct(embedding1, embedding2));
  console.log("dogs vs weather:", dotProduct(embedding1, embedding3));
  console.log("canines vs weather:", dotProduct(embedding2, embedding3));
}

main();
