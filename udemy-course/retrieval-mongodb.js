// =======================================================================
// DEMO: RETRIEVAL - TRUY VẤN & HỎI ĐÁP BẰNG RAG
//
// Tiền đề: Đã chạy file nạp dữ liệu (ingestion) trước đó.
//
// So sánh 4 phương pháp:
// 0. Không RAG      : Hỏi thẳng LLM (chỉ dùng kiến thức sẵn có).
// 1. RAG không LCEL : Gọi thủ công từng bước theo thứ tự.
// 2. RAG có LCEL    : Đóng gói các bước thành 1 chuỗi xử lý tự động (Chain).
// 3. Agentic RAG    : Biến Retriever thành Tool, LLM tự quyết định khi nào tìm.
//
// Luồng RAG cơ bản (3 bước):
// 1. Retrieve : Vector hóa câu hỏi -> Tìm k chunk gần nghĩa nhất.
// 2. Prompt   : Ghép chunk tìm được (Context) + Câu hỏi vào Template.
// 3. Generate : Gửi Prompt cho LLM -> Trả lời dựa trên ngữ cảnh.
//
// Khác biệt chính:
// - Cách 1, 2 : Luôn chạy cố định đủ 3 bước, đúng 1 lần.
// - Cách 3    : LLM có thể bỏ qua Retrieve, hoặc Retrieve nhiều lần với truy vấn khác.
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { MongoClient } = require("mongodb");
const { createAgent } = require("langchain");
const { tool } = require("@langchain/core/tools");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");

// ===== 1. KHỞI TẠO CÁC THÀNH PHẦN =====

console.log("Initializing components...");

// Bắt buộc dùng CÙNG Model Embedding với bước Ingestion để không bị lệch không gian vector
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
});

// Kết nối Vector Collection đã lưu dữ liệu ở bước Ingestion
const client = new MongoClient(process.env.MONGODB_URI);
const collection = client
  .db(process.env.MONGODB_DB)
  .collection(process.env.MONGODB_COLLECTION);

const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
  collection,
  indexName: process.env.INDEX_NAME,
  textKey: "text",
  embeddingKey: "embedding",
});

// Retriever: Lấy k=3 chunk tương đồng nhất với câu hỏi
const retriever = vectorStore.asRetriever({ k: 3 });

// Prompt cho Cách 1 & 2: Ràng buộc LLM chỉ trả lời dựa vào Context
const promptTemplate = ChatPromptTemplate.fromTemplate(
  `Answer the question based only on the following context.
Cite the sources you use.

{context}

Question: {question}

Provide a detailed answer:`,
);

// ===== 2. CÁC HÀM XỬ LÝ =====

/**
 * Gộp các Document thành 1 chuỗi văn bản kèm đường dẫn nguồn.
 */
function formatDocs(docs) {
  return docs
    .map(
      (doc) =>
        `Source: ${doc.metadata.source ?? "Unknown"}\n\nContent: ${doc.pageContent}`,
    )
    .join("\n\n");
}

/**
 * Cách 0: Hỏi trực tiếp LLM không kèm ngữ cảnh.
 */
async function askWithoutRag(query) {
  const response = await llm.invoke([new HumanMessage(query)]);
  return response.content;
}

/**
 * Cách 1: Luồng RAG viết thủ công (không dùng LCEL).
 * Nhược điểm: Code dài, cồng kềnh, không hỗ trợ sẵn Streaming/Batching.
 */
async function askWithRagWithoutLcel(query) {
  // 1. Retrieve: Tìm chunk liên quan
  const docs = await retriever.invoke(query);

  // Cảnh báo nếu không tìm thấy dữ liệu (thường do Vector Index chưa sẵn sàng)
  if (docs.length === 0) {
    console.warn(
      `Không tìm thấy chunk nào. Kiểm tra Vector Index "${process.env.INDEX_NAME}".`,
    );
  }

  // 2. Format & Prompt: Đưa ngữ cảnh và câu hỏi vào Prompt
  const context = formatDocs(docs);
  const messages = await promptTemplate.formatMessages({
    context,
    question: query,
  });

  // 3. Generate: Gọi LLM tạo câu trả lời
  const response = await llm.invoke(messages);
  return response.content;
}

/**
 * Cách 2: Tối ưu luồng RAG bằng LCEL (LangChain Expression Language).
 * Dữ liệu tự động chảy qua chuỗi Pipe: Step 1 -> Step 2 -> Step 3 -> Step 4.
 */
function createRagChainWithLcel() {
  return RunnableSequence.from([
    // Step 1: Chuẩn bị input cho Prompt Template { question, context }
    // Dùng .assign() để BỔ SUNG trường 'context' mà vẫn GIỮ NGUYÊN 'question' gốc
    RunnablePassthrough.assign({
      context: RunnableSequence.from([
        (input) => input.question, // Lấy riêng câu hỏi
        retriever,                 // Lấy các chunk liên quan
        formatDocs,                // Gộp chunk thành văn bản
      ]),
    }),

    // Step 2: Điền { question, context } vào Template -> Ra PromptValue
    promptTemplate,

    // Step 3: Gửi PromptValue cho LLM -> Ra AIMessage
    llm,

    // Step 4: Trích xuất nội dung văn bản từ AIMessage -> Ra String
    new StringOutputParser(),
  ]);
}

/**
 * Định nghĩa Tool tìm kiếm tài liệu cho Agent (Cách 3).
 * Ở đây chỉ định nghĩa, chưa chạy. Tool chỉ chạy khi LLM yêu cầu gọi (xem createAgent bên dưới).
 * - description: LLM đọc để quyết định có cần gọi Tool không.
 * - schema     : Tham số LLM phải điền khi yêu cầu gọi Tool (ở đây là query).
 *
 * responseFormat = "content_and_artifact":
 * - content : Chuỗi văn bản cho LLM đọc.
 * - artifact: Mảng Document gốc dùng để truy xuất metadata hiển thị nguồn.
 */
const retrieveContext = tool(
  async ({ query }) => {
    const docs = await retriever.invoke(query);
    return [formatDocs(docs), docs];
  },
  {
    name: "retrieve_context",
    description:
      "Retrieve relevant documents from the knowledge base (LangChain documentation, articles about vector databases).",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
    responseFormat: "content_and_artifact",
  },
);

/**
 * Cách 3: Agentic RAG - Để LLM tự quyết định khi nào gọi Tool truy vấn.
 * - Ưu điểm  : Động, linh hoạt theo ngữ cảnh câu hỏi.
 * - Nhược điểm: Tốn ít nhất 2 lần gọi LLM (đắt hơn, độ trễ cao hơn).
 */
async function askWithAgenticRag(query) {
  const systemPrompt = `You are a helpful AI assistant that answers questions using a knowledge base.
You have access to a tool that retrieves relevant documents.
Use the tool to find relevant information before answering questions.
Always cite the sources you use in your answers.
If you cannot find the answer in the retrieved documents, say so.`;

  // Khai báo tools: Agent sẽ tự động chạy tool và gửi lại kết quả cho LLM theo vòng lặp cho đến khi hoàn tất.
  const agent = createAgent({
    model: llm,
    tools: [retrieveContext],
    systemPrompt,
  });

  const response = await agent.invoke({
    messages: [{ role: "user", content: query }],
  });

  console.log('response', response);

  // Lấy câu trả lời cuối từ message của LLM
  const answer = response.messages.at(-1).text;

  // Trích xuất mảng Document từ artifact trong các ToolMessage để lấy nguồn trích dẫn
  const context = response.messages
    .filter((m) => ToolMessage.isInstance(m) && Array.isArray(m.artifact))
    .flatMap((m) => m.artifact);

  console.log('answer', answer);
  console.log('context', context);

  return { answer, context };
}

/**
 * In tiêu đề các phần demo.
 */
function printSection(title) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

// ===== 3. THỰC THI =====

async function main() {
  console.log("Retrieving...");
  const query = "what is Pinecone in machine learning?";

  try {
    // printSection("IMPLEMENTATION 0: Raw LLM Invocation (No RAG)");
    // console.log("\nAnswer:");
    // console.log(await askWithoutRag(query));

    // printSection("IMPLEMENTATION 1: Without LCEL");
    // console.log("\nAnswer:");
    // console.log(await askWithRagWithoutLcel(query));

    // printSection("IMPLEMENTATION 2: With LCEL");
    // console.log("\nAnswer:");
    // const ragChain = createRagChainWithLcel();
    // console.log(await ragChain.invoke({ question: query }));

    printSection("IMPLEMENTATION 3: Agentic RAG (createAgent + Tool)");
    const { answer, context } = await askWithAgenticRag(query);
    console.log("\nAnswer:");
    console.log(answer);
    console.log(`\nSources (${context.length} chunks):`);
    context.forEach((doc) =>
      console.log(`  - ${doc.metadata.source} (id: ${doc.metadata._id})`),
    );
  } finally {
    await client.close();
  }
}

main().catch(console.error);