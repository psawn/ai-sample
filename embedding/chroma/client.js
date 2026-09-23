// =======================================================================
// CHROMA - SO SÁNH 2 EMBEDDING MODEL (LOCAL vs GEMINI)
//
// Cùng dữ liệu, cùng câu hỏi, đổi embedding model -> kết quả tìm kiếm khác nhau.
// - Default (ONNX MiniLM-L6-v2): chạy local, miễn phí, nhanh, nhưng hiểu tiếng Việt kém.
// - Gemini: gọi API, tốn phí/mạng, nhưng hiểu nghĩa đa ngôn ngữ (cả tiếng Việt) tốt hơn.
//
// Lưu ý:
// 1. Mỗi model có không gian vector và số chiều riêng -> mỗi model 1 collection riêng.
//    Không trộn vector của 2 model trong cùng 1 collection.
// 2. Gắn embeddingFunction vào collection -> Chroma tự embed khi add() và query().
//    Code chỉ cần truyền text, không phải tự đổi text -> vector.
//
// Cần chạy Chroma server trước:
//   docker run -d --name chroma -p 8000:8000 chromadb/chroma
// =======================================================================

require("dotenv").config();
const { ChromaClient } = require("chromadb");
const { DefaultEmbeddingFunction } = require("@chroma-core/default-embed");
const { GoogleGeminiEmbeddingFunction } = require("@chroma-core/google-gemini");

// Kết nối Chroma server. Không set biến môi trường -> dùng localhost:8000.
const client = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});

// Dữ liệu mẫu.
const documents = [
  "Con chó chạy trong công viên",
  "Con mèo ngủ trên ghế sofa",
  "Máy bay cất cánh từ sân bay",
];

// Câu hỏi không trùng chữ với dữ liệu, phải hiểu nghĩa mới tìm đúng.
// Kỳ vọng: "Con chó chạy trong công viên" (con vật + ngoài trời).
const queryText = "con vật ngoài đường";

// 2 embedding model cần so sánh.
const defaultEmbeddingFunction = new DefaultEmbeddingFunction();
const geminiEmbeddingFunction = new GoogleGeminiEmbeddingFunction({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: "gemini-embedding-001",
});

// Chạy trọn luồng với 1 embedding model:
// 1. Tạo (hoặc lấy) collection, gắn embeddingFunction.
// 2. add(): Chroma tự embed documents, lưu vào collection.
// 3. query(): Chroma embed câu hỏi bằng cùng model, trả document gần nhất.
// name: tên collection, mỗi model 1 tên riêng.
async function queryWith(name, embeddingFunction) {
  const collection = await client.getOrCreateCollection({ name, embeddingFunction });

  await collection.add({ ids: ["1", "2", "3"], documents });

  // nResults: 1 -> chỉ lấy 1 document gần nhất.
  return collection.query({ queryTexts: [queryText], nResults: 1 });
}

// ===== KỊCH BẢN MINH HỌA =====
// Chạy lần lượt 2 model trên cùng dữ liệu + câu hỏi, in kết quả để so sánh.
async function main() {
  // Model local (MiniLM).
  const defaultResult = await queryWith("data-test", defaultEmbeddingFunction);

  // Model Gemini (gọi API).
  const geminiResult = await queryWith("data-test-gemini", geminiEmbeddingFunction);

  console.log(`Query: "${queryText}"\n`);
  console.log("Default:", defaultResult);
  console.log("Gemini:", geminiResult);
}

main();