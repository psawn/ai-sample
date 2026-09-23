// =======================================================================
// CHROMA - TÌM ẢNH BẰNG MÔ TẢ TEXT (CLIP)
//
// 1. CLIP embed được cả ảnh và text vào cùng 1 không gian vector.
// 2. Index: embed từng ảnh trong thư mục images/, lưu vào Chroma.
// 3. Search: embed câu mô tả -> tìm ảnh có vector gần nhất.
//
// Tìm ảnh bằng ý nghĩa, không cần gắn tag hay đặt tên file.
// CLIP chạy local (@huggingface/transformers), không gọi API. Lần đầu tải model về máy.
//
// Cần chạy Chroma server trước:
//   docker run -d --name chroma -p 8000:8000 chromadb/chroma
// =======================================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { ChromaClient } = require("chromadb");
const {
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} = require("@huggingface/transformers");

// Lưu ý: CLIP_MODEL chủ yếu học từ dữ liệu tiếng Anh -> hiểu tiếng Việt kém.
// Vd: "ảnh con mèo" cho các distance sát nhau, khó phân biệt.
// Hỏi bằng tiếng Anh ("a photo of a cat") cho kết quả rõ hơn nhiều.
//
// Muốn hỗ trợ tiếng Việt tốt hơn:
// - Dùng CLIP đa ngôn ngữ.
// - Hoặc dịch query sang tiếng Anh trước khi embed.
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const IMAGES_DIR = path.join(__dirname, "..", "..", "images");
const COLLECTION_NAME = "image-search";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

const client = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});

// Model CLIP load 1 lần, dùng lại cho các lần gọi sau.
// - tokenizer: text -> token id cho text model.
// - processor: resize + chuẩn hóa ảnh cho vision model.
let tokenizer, processor, textModel, visionModel;

// Load model CLIP (chỉ load ở lần gọi đầu tiên, các lần sau bỏ qua).
async function loadClipModels() {
  if (!tokenizer) {
    tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL);
    processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
    // CLIP có 2 model riêng nhưng vector ra cùng không gian -> so sánh được:
    // - Text model: text -> vector.
    // - Vision model: ảnh -> vector.
    // Độ lớn (norm) vector 2 bên có thể khác nhau -> normalize() trước khi so.
    textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL);
    visionModel =
      await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL);
  }
}

// Đưa vector về độ dài 1. Khi đó so sánh chỉ còn dựa vào hướng
// (dot product = cosine similarity).
// Array.from: đổi Float32Array (output của model) thành mảng thường cho Chroma.
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return Array.from(vector, (v) => v / norm);
}

// Ảnh -> vector (đã normalize).
async function embedImage(imagePath) {
  await loadClipModels();
  const image = await RawImage.read(imagePath);
  const imageInputs = await processor(image);
  const { image_embeds } = await visionModel(imageInputs);
  return normalize(image_embeds.data);
}

// Text -> vector (đã normalize).
async function embedText(text) {
  await loadClipModels();
  const textInputs = tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);
  return normalize(text_embeds.data);
}

// Lấy danh sách file ảnh trong thư mục images/.
function listImageFiles() {
  if (!fs.existsSync(IMAGES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(IMAGES_DIR)
    .filter((file) =>
      IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()),
    );
}

// Lấy collection, đo khoảng cách bằng cosine: distance = 1 - cosine similarity,
// càng nhỏ càng giống. Mặc định Chroma dùng l2 (khoảng cách Euclid).
// Không gắn embeddingFunction: code tự embed bằng CLIP rồi truyền vector vào.
async function getCollection() {
  return client.getOrCreateCollection({
    name: COLLECTION_NAME,
    configuration: { hnsw: { space: "cosine" } },
  });
}

// Index các ảnh chưa có trong Chroma. Ảnh đã index thì bỏ qua.
// Dùng tên file làm id để biết ảnh nào đã index.
// Lưu ý: sửa nội dung ảnh nhưng giữ tên file -> không index lại.
async function indexImages() {
  const collection = await getCollection();
  const existing = await collection.get();
  const indexedFiles = new Set(existing.ids);

  const files = listImageFiles().filter((file) => !indexedFiles.has(file));
  if (files.length === 0) {
    console.log("Không có ảnh mới cần index.\n");
    return collection;
  }

  console.log(`Đang index ${files.length} ảnh mới...`);
  for (const file of files) {
    console.log(`Đang index: ${file}`);
    const embedding = await embedImage(path.join(IMAGES_DIR, file));
    await collection.add({
      ids: [file],
      embeddings: [embedding],
      metadatas: [{ filename: file }],
    });
  }
  console.log("");

  return collection;
}

// Tìm nResults ảnh gần với câu mô tả nhất.
// query() trả mảng lồng (mỗi câu hỏi 1 mảng) -> lấy [0] vì chỉ có 1 câu hỏi.
async function searchByText(collection, query, nResults = 3) {
  const queryEmbedding = await embedText(query);
  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
  });

  return result.ids[0].map((id, i) => ({
    filename: id,
    distance: result.distances[0][i],
  }));
}

// ===== KỊCH BẢN MINH HỌA =====
// Index ảnh -> mở CLI cho user gõ mô tả để tìm ảnh.
async function main() {
  if (listImageFiles().length === 0) {
    console.error(
      `Không tìm thấy ảnh nào trong ${IMAGES_DIR}. Hãy thêm ảnh rồi chạy lại.`,
    );
    process.exit(1);
  }

  const collection = await indexImages();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log('Gõ mô tả ảnh bạn muốn tìm. Gõ "exit" để thoát.\n');

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
        const matches = await searchByText(collection, trimmed);
        console.log("");
        matches.forEach((match, i) => {
          console.log(
            `${i + 1}. ${match.filename} (distance: ${match.distance.toFixed(4)})`,
          );
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
