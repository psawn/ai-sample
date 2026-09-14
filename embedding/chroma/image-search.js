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

/// LƯU Ý: CLIP_MODEL ("Xenova/clip-vit-base-patch32") được huấn luyện
// chủ yếu trên dữ liệu tiếng Anh nên khả năng hiểu tiếng Việt khá hạn chế.
//
// Test thực tế: query tiếng Việt như "ảnh con mèo" cho kết quả kém,
// các distance khá sát nhau và khó phân biệt. Cùng nội dung đó nhưng
// hỏi bằng tiếng Anh thì kết quả rõ ràng hơn.
//
// Nếu cần hỗ trợ tiếng Việt tốt hơn, có thể:
// - Dùng CLIP đa ngôn ngữ
// - Hoặc dịch query tiếng Việt → tiếng Anh trước khi embed
const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
const IMAGES_DIR = path.join(__dirname, "..", "..", "images");
const COLLECTION_NAME = "image-search";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

const client = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});

let tokenizer, processor, textModel, visionModel;

async function loadClipModels() {
  if (!tokenizer) {
    tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL);
    processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
    // CLIP dùng 2 model riêng nhưng cho ra vector cùng không gian, nên so sánh được với nhau:
    // - Text model: text → text embedding
    // - Vision model: image → image embedding
    // Độ dài vector 2 bên có thể khác nhau nên phải normalize()
    textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL);
    visionModel =
      await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL);
  }
}

// Đưa vector về độ dài 1, để so sánh chỉ còn dựa vào hướng (dot product = cosine similarity).
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return Array.from(vector, (v) => v / norm);
}

async function embedImage(imagePath) {
  await loadClipModels();
  const image = await RawImage.read(imagePath);
  const imageInputs = await processor(image);
  const { image_embeds } = await visionModel(imageInputs);
  return normalize(image_embeds.data);
}

async function embedText(text) {
  await loadClipModels();
  const textInputs = tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);
  return normalize(text_embeds.data);
}

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

async function getCollection() {
  return client.getOrCreateCollection({
    name: COLLECTION_NAME,
    configuration: { hnsw: { space: "cosine" } },
  });
}

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
