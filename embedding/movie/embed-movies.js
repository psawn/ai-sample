// =======================================================================
// EMBEDDING - BƯỚC 1: TẠO VECTOR CHO DANH SÁCH PHIM
//
// 1. Gộp tên + thể loại + mô tả của phim thành 1 đoạn text.
// 2. Embed đoạn text đó thành vector.
// 3. Lưu ra movie-embeddings.json để recommend-movies.js dùng lại.
//
// Embed 1 lần, lưu file. Lúc tìm kiếm chỉ cần embed câu hỏi -> nhanh, ít tốn API.
// Sửa movie.json -> phải chạy lại file này.
// =======================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const INPUT_FILE = path.join(__dirname, "movie.json");
const OUTPUT_FILE = path.join(__dirname, "movie-embeddings.json");
const EMBEDDING_MODEL = "gemini-embedding-001";

// Gộp thông tin phim thành 1 đoạn text. Càng đủ thông tin, vector càng "hiểu" phim.
// Vd: "Interstellar. Genres: Sci-Fi, Drama, Adventure. Astronauts travel through a wormhole..."
function toEmbeddingText(movie) {
  return `${movie.title}. Genres: ${movie.genres.join(", ")}. ${movie.description}`;
}

// Gọi model lấy vector embedding của 1 đoạn text.
async function embedText(model, text) {
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function main() {
  const movies = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  console.log(`Đang tính embedding cho ${movies.length} phim...`);

  // Embed tuần tự từng phim, để tránh rate limit.
  // Lưu kèm id/title/genres/description để lúc gợi ý không cần đọc lại movie.json.
  const results = [];
  for (const [index, movie] of movies.entries()) {
    const embedding = await embedText(model, toEmbeddingText(movie));
    results.push({
      id: movie.id,
      title: movie.title,
      genres: movie.genres,
      description: movie.description,
      embedding,
    });
    console.log(`[${index + 1}/${movies.length}] ${movie.title}`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Đã lưu embedding vào ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error("Lỗi khi tính embedding:", error);
  process.exit(1);
});
