// =======================================================================
// CHROMA - RAG HỎI ĐÁP VỀ APPLE
//
// RAG = Retrieval-Augmented Generation.
// 1. Retrieval: tìm đoạn tài liệu liên quan nhất trong Chroma.
// 2. Augmented: nhét đoạn đó vào prompt làm context.
// 3. Generation: LLM trả lời dựa trên context, hạn chế bịa.
//
// Bản LangChain (nhiều document, chain dựng sẵn): ../../langchain/07-qa/.
//
// Cần chạy Chroma server trước:
//   docker run -d --name chroma -p 8000:8000 chromadb/chroma
// =======================================================================

require("dotenv").config();
const readline = require("readline");
const { ChromaClient } = require("chromadb");
const { GoogleGeminiEmbeddingFunction } = require("@chroma-core/google-gemini");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

const embeddingFunction = new GoogleGeminiEmbeddingFunction({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: "gemini-embedding-001",
});

// Kho kiến thức mẫu: mỗi mục là 1 document trong Chroma. id: dùng làm id trong Chroma.
const knowledgeBase = [
  {
    id: "founding",
    text: "Apple được thành lập ngày 1/4/1976 bởi Steve Jobs, Steve Wozniak và Ronald Wayne tại Cupertino, California, ban đầu để bán chiếc máy tính Apple I do Wozniak tự lắp ráp. Ronald Wayne rút khỏi công ty chỉ 12 ngày sau đó, bán lại 10% cổ phần với giá 800 USD.",
  },
  {
    id: "products",
    text: "Các sản phẩm chủ lực của Apple gồm iPhone (ra mắt 2007), Mac, iPad, Apple Watch, AirPods và dịch vụ Apple Music, iCloud, App Store. iPhone hiện đóng góp hơn một nửa doanh thu toàn công ty.",
  },
  {
    id: "leadership",
    text: "Tim Cook trở thành CEO của Apple từ tháng 8/2011, kế nhiệm Steve Jobs sau khi Jobs qua đời vì ung thư tuyến tụy. Trước đó Cook giữ vai trò COO, nổi tiếng với việc tối ưu chuỗi cung ứng toàn cầu của Apple.",
  },
  {
    id: "headquarters",
    text: "Trụ sở chính của Apple là Apple Park, một tòa nhà hình vành khuyên tại Cupertino, California, khánh thành năm 2017 với chi phí xây dựng khoảng 5 tỷ USD, có sức chứa khoảng 12.000 nhân viên.",
  },
  {
    id: "financials",
    text: "Apple là công ty đại chúng đầu tiên trên thế giới đạt vốn hóa thị trường 1.000 tỷ USD vào năm 2018, và tiếp tục là một trong những công ty giá trị nhất thế giới với doanh thu hàng năm hơn 380 tỷ USD.",
  },
  {
    id: "retail",
    text: "Apple vận hành mạng lưới hơn 500 cửa hàng bán lẻ Apple Store trên toàn cầu. Cửa hàng đầu tiên khai trương năm 2001 tại Tysons Corner, Virginia, với thiết kế đặc trưng dùng nhiều kính và ánh sáng tự nhiên.",
  },
];

const collectionName = "apple-knowledge";

// Lấy collection. Còn trống thì nạp knowledgeBase vào.
// Lưu ý: collection đã có dữ liệu -> bỏ qua. Sửa knowledgeBase -> phải xóa collection cũ.
async function ensurePopulated() {
  // embeddingFunction tự embed text -> chỉ cần truyền text thô vào add() và query().
  const collection = await chroma.getOrCreateCollection({ name: collectionName, embeddingFunction });

  const count = await collection.count();

  if (count === 0) {
    await collection.add({
      ids: knowledgeBase.map((item) => item.id),
      documents: knowledgeBase.map((item) => item.text),
    });
    console.log(`Đã nạp ${knowledgeBase.length} tài liệu vào collection "${collectionName}".\n`);
  }

  return collection;
}

// Trả lời câu hỏi theo RAG (3 bước ở header).
async function answerQuestion(collection, question) {
  // 1. Retrieval: lấy 1 document gần câu hỏi nhất.
  // nResults: 1 -> câu hỏi cần thông tin từ 2 document sẽ thiếu context. Tăng lên nếu cần.
  // documents[0][0]: câu hỏi đầu tiên, document đầu tiên.
  const result = await collection.query({ queryTexts: [question], nResults: 1 });
  const context = result.documents[0][0];

  if (!context) {
    return "Không tìm thấy thông tin liên quan để trả lời câu hỏi này.";
  }

  // 2. Augmented + 3. Generation: đưa context vào prompt, LLM trả lời.
  const prompt = `Dựa vào thông tin sau đây, hãy trả lời câu hỏi ngắn gọn và chính xác.\n\nThông tin: ${context}\n\nCâu hỏi: ${question}`;
  const result2 = await chatModel.generateContent(prompt);
  return result2.response.text();
}

// ===== KỊCH BẢN MINH HỌA =====
// Nạp dữ liệu -> mở CLI cho user hỏi về Apple.
async function main() {
  const collection = await ensurePopulated();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Hỏi bất cứ điều gì về Apple. Gõ "exit" để thoát.\n');

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
        const answer = await answerQuestion(collection, trimmed);
        console.log(`\nBot: ${answer}\n`);
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
