require("../_polyfill");
require("dotenv").config();

const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableMap, RunnableLambda } = require("@langchain/core/runnables");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// ============================
// 1. Simple Chain
// ============================
// Luồng xử lý (prompt.pipe(model).pipe(outputParser)):
// 1. prompt: điền {topic} vào template có sẵn.
// 2. model: gửi prompt cho LLM, nhận về AIMessage.
// 3. outputParser: lấy phần text từ AIMessage.content, bỏ phần metadata.
async function simpleChainDemo() {
  const prompt = ChatPromptTemplate.fromTemplate(
    "tell me a short joke about {topic}",
  );
  const outputParser = new StringOutputParser();

  const chain = prompt.pipe(model).pipe(outputParser);

  const result = await chain.invoke({ topic: "bears" });
  console.log("\n=== 1. Simple Chain ===");
  console.log(result);
}

// ============================
// 2. More complex chain (RunnableMap + retriever)
// ============================
// Luồng RAG cơ bản:
// 1. RunnableMap: chạy song song nhiều nhánh, mỗi nhánh nhận cùng 1 input.
// 2. retriever tìm đoạn context liên quan tới câu hỏi.
// 3. Gom context + question lại thành 1 object, đưa vào prompt.
// 4. prompt -> model -> outputParser: LLM trả lời dựa trên context vừa tìm được.
async function complexChainDemo() {
  // MemoryVectorStore: lưu embedding trong RAM. embeddings gọi API Gemini để
  // biến từng câu thành vector.
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey,
    model: "gemini-embedding-001",
  });
  const vectorstore = await MemoryVectorStore.fromTexts(
    ["harrison worked at kensho", "bears like to eat honey"],
    // metadata cho từng câu text ở trên (theo đúng thứ tự) - để trống khi
    // không cần lọc / gắn thêm thông tin gì cho đoạn text.
    [{}, {}],
    embeddings,
  );
  const retriever = vectorstore.asRetriever();

  // retriever.invoke(): embed câu hỏi rồi tìm các đoạn văn bản gần nghĩa nhất.
  const docs1 = await retriever.invoke("where did harrison work?");
  console.log("\n=== 2a. retriever.invoke: harrison worked at ===");
  console.log(docs1.map((d) => d.pageContent));

  const docs2 = await retriever.invoke("what do bears like to eat");
  console.log("\n=== 2b. retriever.invoke: bears like to eat ===");
  console.log(docs2.map((d) => d.pageContent));

  // Gộp các đoạn văn bản liên quan thành 1 chuỗi text trước khi đưa vào prompt,
  // vì {context} trong prompt cần là text chứ không phải object.
  function formatDocuments(docs) {
    return docs.map((doc) => doc.pageContent).join("\n\n");
  }

  const template = `Answer the question based only on the following context:
{context}

Question: {question}
`;
  const prompt = ChatPromptTemplate.fromTemplate(template);
  const outputParser = new StringOutputParser();

  // RunnableMap.from({...}): mỗi key tự tính giá trị từ input gốc ({ question }):
  // - context: gọi retriever (bất đồng bộ) lấy đoạn liên quan, gộp thành text.
  // - question: lấy nguyên input.question.
  const chain = RunnableMap.from({
    context: async (x) => formatDocuments(await retriever.invoke(x.question)),
    question: (x) => x.question,
  })
    .pipe(prompt)
    .pipe(model)
    .pipe(outputParser);

  const answer = await chain.invoke({ question: "where did harrison work?" });
  console.log("\n=== 2c. Complex chain (RunnableMap -> prompt -> model) ===");
  console.log(answer);

  // Có thể dùng riêng RunnableMap để xem trước context/question được gom ra sao,
  // trước khi đưa vào prompt.
  const inputs = RunnableMap.from({
    context: async (x) => formatDocuments(await retriever.invoke(x.question)),
    question: (x) => x.question,
  });
  const mappedInputs = await inputs.invoke({
    question: "where did harrison work?",
  });
  console.log("\n=== 2d. RunnableMap đứng riêng (context + question) ===");
  console.log(mappedInputs);
}

// ============================
// 3. Bind (gắn sẵn tools cho model)
// ============================
// model.withConfig({ tools }) (thay cho .bind() đã deprecated, cùng cách dùng):
// 1. Tạo ra 1 Runnable mới đã gắn sẵn danh sách tools vào model.
// 2. Mọi invoke sau này tự động kèm theo tools đó, không cần truyền lại.
// Format tools giống file test/01-function-calling.js.
async function bindDemo() {
  const prompt = ChatPromptTemplate.fromMessages([["human", "{input}"]]);

  const weatherTools = [
    {
      type: "function",
      function: {
        name: "weather_search",
        description: "Search for weather given an airport code",
        parameters: {
          type: "object",
          properties: {
            airport_code: {
              type: "string",
              description: "The airport code to get the weather for",
            },
          },
          required: ["airport_code"],
        },
      },
    },
  ];
  const sportTools = [
    {
      type: "function",
      function: {
        name: "sports_search",
        description: "Search for news of recent sport events",
        parameters: {
          type: "object",
          properties: {
            team_name: {
              type: "string",
              description: "The sports team to search for",
            },
          },
          required: ["team_name"],
        },
      },
    },
  ];

  const modelWithWeatherTool = model.withConfig({ tools: weatherTools });
  const runnable = prompt.pipe(modelWithWeatherTool);

  const weatherResponse = await runnable.invoke({
    input: "what is the weather in sf",
  });
  console.log("\n=== 3a. Bind: 1 tool (weather_search) ===");
  console.log("tool_calls:", weatherResponse.tool_calls);

  // Gắn thêm 1 tool nữa (sports_search) - model tự chọn tool phù hợp với câu hỏi.
  const multiTools = [...weatherTools, ...sportTools];

  const modelWithMultiTools = model.withConfig({ tools: multiTools });
  const runnableMultiTools = prompt.pipe(modelWithMultiTools);

  const sportsResponse = await runnableMultiTools.invoke({
    input: "how did the patriots do yesterday?",
  });
  console.log("\n=== 3b. Bind: 2 tools (weather_search + sports_search) ===");
  console.log("tool_calls:", sportsResponse.tool_calls);

  // Câu hỏi không liên quan tới tool nào -> model tự trả lời bằng chữ, không
  // gọi tool (tool_calls rỗng).
  const chatResponse = await runnableMultiTools.invoke({
    input: "hi, how are you?",
  });
  console.log("\n=== 3c. Bind: câu hỏi không liên quan -> không gọi tool ===");
  console.log("tool_calls:", chatResponse.tool_calls);
  console.log("content:", chatResponse.content);
}

// ============================
// 4. Fallbacks
// ============================
// withFallbacks: nếu chain chính lỗi (throw), tự động thử chain dự phòng theo
// thứ tự khai báo, thay vì crash luôn. Demo dưới đây:
// 1. simpleChain: không dặn model về format -> hay bọc JSON trong ```json```
//    (markdown) -> JSON.parse() lỗi.
// 2. strictJsonChain: dặn rõ chỉ trả JSON thuần -> parse ổn định hơn.
// 3. finalChain: chạy simpleChain trước, nếu lỗi thì tự động fallback qua strictJsonChain.
async function fallbacksDemo() {
  const challenge =
    "write three poems in a json blob, where each poem is a json blob of a title, author, and first line";

  // So sánh RunnableMap vs RunnableLambda
  // - Cả 2 đều là Runnable, .pipe() được vào chain:
  // - RunnableMap.from({ key1: fn1, key2: fn2 }): chạy NHIỀU nhánh SONG SONG
  //   trên cùng 1 input, gộp kết quả thành 1 object nhiều key.
  // - RunnableLambda.from(fn): bọc 1 hàm DUY NHẤT, 1 input -> 1 output.
  // Ví dụ minh hoạ:
  //   await RunnableMap.from({
  //     upper: (s) => s.toUpperCase(),
  //     length: (s) => s.length,
  //   }).invoke("hi"); // -> { upper: "HI", length: 2 }
  //
  //   await RunnableLambda.from((s) => s.toUpperCase()).invoke("hi"); // -> "HI"

  // Chain đơn giản: không dặn model về format, JSON.parse() dễ lỗi nếu model
  // trả kèm markdown code fence hoặc lời giải thích.
  const simpleChain = model
    .pipe(new StringOutputParser())
    .pipe(RunnableLambda.from((text) => JSON.parse(text)));

  console.log(
    "\n=== 4a. simpleChain.invoke (dự kiến có thể lỗi JSON.parse) ===",
  );
  try {
    const result = await simpleChain.invoke(challenge);
    console.log(result);
  } catch (error) {
    console.log("Lỗi JSON.parse:", error.message);
  }

  // Chain dự phòng: thêm SystemMessage dặn model chỉ trả JSON thuần, không
  // markdown, không giải thích thêm -> parse ổn định hơn.
  //
  // RunnableLambda.from(fn): bọc 1 hàm JS bình thường thành 1 Runnable, để
  // .pipe() được vào chain. Ví dụ:
  //   const double = RunnableLambda.from((x) => x * 2);
  //   await double.invoke(3); // -> 6
  //
  // Vì sao chain này bắt đầu bằng RunnableLambda.from thay vì model.pipe như
  // simpleChain:
  // 1. simpleChain gọi model trực tiếp bằng string -> chỉ cần .pipe() nối tiếp.
  // 2. Chain này cần model nhận thêm 1 SystemMessage dặn dò -> phải biến input
  //    (string) thành mảng [SystemMessage, HumanMessage] TRƯỚC khi vào model.
  // 3. .pipe() không tự tạo input mới cho bước đầu chain, nên bước biến đổi đó
  //    phải là RunnableLambda.from((text) => [...]), rồi mới .pipe(model) tiếp.
  //
  // RunnableLambda.from((text) -> "text" là input string ban đầu (biến challenge)
  const strictJsonChain = RunnableLambda.from((text) => [
    new SystemMessage(
      "Only output raw JSON. Do not wrap it in markdown code fences and do not add any explanation.",
    ),
    new HumanMessage(text),
  ])
    .pipe(model)
    .pipe(new StringOutputParser())
    .pipe(RunnableLambda.from((text) => JSON.parse(text)));

  // finalChain: thử simpleChain trước, nếu lỗi thì tự động chạy strictJsonChain.
  const finalChain = simpleChain.withFallbacks([strictJsonChain]);

  const finalResult = await finalChain.invoke(challenge);
  console.log("\n=== 4b. finalChain.invoke (có fallback) ===");
  console.log(finalResult);
}

// ============================
// 5. Interface (invoke / batch / stream)
// ============================
// Mọi Runnable trong LCEL đều có chung 1 bộ method để chạy chain:
// 1. invoke: chạy 1 input, đợi kết quả trả về đầy đủ.
// 2. batch: chạy nhiều input song song, trả về mảng kết quả theo đúng thứ tự.
// 3. stream: nhận kết quả từng phần ngay khi model sinh ra, không cần đợi xong hết.
async function interfaceDemo() {
  const prompt = ChatPromptTemplate.fromTemplate(
    "Tell me a short joke about {topic}",
  );
  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);

  const invokeResult = await chain.invoke({ topic: "bears" });
  console.log("\n=== 5a. chain.invoke ===");
  console.log(invokeResult);

  const batchResult = await chain.batch([
    { topic: "bears" },
    { topic: "frogs" },
  ]);
  console.log("\n=== 5b. chain.batch ===");
  console.log(batchResult);

  // In từng chunk ngay khi nhận được - hữu ích khi hiển thị real-time cho người dùng.
  console.log("\n=== 5c. chain.stream ===");
  for await (const chunk of await chain.stream({ topic: "bears" })) {
    process.stdout.write(chunk);
  }
  console.log();
}

async function main() {
  // await simpleChainDemo();
  // await complexChainDemo();
  // await bindDemo();
  // await fallbacksDemo();
  await interfaceDemo();
}

main();
