// =======================================================================
// EMBEDDING - BƯỚC 2: GỢI Ý PHIM THEO MÔ TẢ
//
// 1. Đọc vector phim đã tạo sẵn ở embed-movies.js.
// 2. Embed mô tả của user thành vector.
// 3. Tính cosine similarity với từng phim, lấy TOP_K phim giống nhất.
//
// Tìm theo ý nghĩa, không cần trùng từ khóa.
// Vd: "phim về vũ trụ" vẫn tìm được phim có mô tả "space".
//
// Phải dùng cùng embedding model với embed-movies.js. Khác model -> vector không so sánh được.
// =======================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const EMBEDDINGS_FILE = path.join(__dirname, "movie-embeddings.json");
const EMBEDDING_MODEL = "gemini-embedding-001";
const TOP_K = 5;

// Cosine similarity: đo góc giữa 2 vector, không phụ thuộc độ dài vector.
// Kết quả từ -1 tới 1, càng gần 1 càng giống.
// = dot(a, b) / (|a| * |b|).
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Chấm điểm từng phim so với câu hỏi, sắp xếp giảm dần, lấy topK phim đầu.
// So sánh với mọi phim (brute force): ổn với vài trăm phim. Dữ liệu lớn -> dùng vector DB (xem ../chroma/).
function findTopMovies(movies, queryEmbedding, topK) {
  return movies
    .map((movie) => ({
      ...movie,
      score: cosineSimilarity(queryEmbedding, movie.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  if (!fs.existsSync(EMBEDDINGS_FILE)) {
    console.error(
      `Không tìm thấy ${EMBEDDINGS_FILE}. Hãy chạy embed-movies.js trước.`,
    );
    process.exit(1);
  }

  const movies = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, "utf-8"));
  const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log('Gõ mô tả phim bạn muốn tìm. Gõ "exit" để thoát.\n');

  const askQuestion = () => {
    rl.question("Bạn: ", async (userInput) => {
      const trimmed = userInput.trim();
      if (["exit", "quit"].includes(trimmed.toLowerCase())) {
        rl.close();
        return;
      }
      if (!trimmed) {
        askQuestion();
        return;
      }

      try {
        // Bước 1: đổi mô tả của user thành vector.
        const { embedding } = await embeddingModel.embedContent(trimmed);
        const queryEmbedding = embedding.values;
        // Bước 2: so với vector từng phim, lấy TOP_K phim giống nhất.
        const topMovies = findTopMovies(movies, queryEmbedding, TOP_K);

        console.log("");
        topMovies.forEach((movie, index) => {
          console.log(
            `${index + 1}. ${movie.title} (${movie.genres.join(", ")}) - độ tương đồng: ${movie.score.toFixed(4)}`,
          );
          console.log(`   ${movie.description}`);
        });
        console.log("");
      } catch (error) {
        console.error("Lỗi:", error.message);
      }

      askQuestion();
    });
  };

  askQuestion();

  rl.on("close", () => {
    console.log("\nTạm biệt!");
    process.exit(0);
  });
}

main();
