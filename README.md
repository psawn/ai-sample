# AI Learning Lab (Node.js)

Repo tự học xây ứng dụng LLM bằng JavaScript (CommonJS): từ gọi API thô → embedding → LangChain → LangGraph / agent / memory.
Mỗi file là một bài demo chạy độc lập, comment tiếng Việt giải thích ở đầu file.

## Cài đặt

```bash
npm install
cp .env.example .env   # điền key cần dùng
node 03-langchain/01-basics/01-model-invoke-batch-stream.js
```

Chạy file từ **thư mục gốc repo**. Hầu hết bài dùng Gemini (`GEMINI_API_KEY`).

## Cấu trúc

```
00-llm-fundamentals/  Khái niệm nền của LLM: token, sampling
01-sdk-basics/     Gọi thẳng SDK OpenAI / Gemini / HuggingFace
02-embeddings/     Embedding, cosine similarity, Chroma, RAG tự viết
03-langchain/      Track chính: 15 chương LangChain → LangGraph → Deep Agents
04-typesafe/       Port chương 14 (email assistant) sang @typesafe-ai/sdk
05-udemy-course/   Khóa Udemy: agent loop, RAG MongoDB, LangGraph agents, agentic RAG, MCP
06-improving-accuracy/  DeepLearning.AI Improving Accuracy of LLM Applications: prompt template, Text-to-SQL, eval
_shared/           Module dùng chung toàn repo (polyfill.js)
data/              Dữ liệu mẫu: cs229_lectures/*.pdf, mediumblog1.txt
images/samples/    Ảnh input cho 02-embeddings/03-chroma/03-image-search.js
images/graphs/     Sơ đồ LangGraph do script sinh ra (<tên-script>-flow.png), commit sẵn để xem không cần chạy
plans/             Kế hoạch project làm sau (vd text-to-sql-nestjs.md)
LEARNING-CONTEXT.md  Background, mục tiêu, khóa đã/đang học, ưu tiên học
```

### Quy ước đặt tên

| Mẫu | Ý nghĩa |
|---|---|
| `NN-ten-bai.js` | Bài học, đọc theo thứ tự số |
| `NNa-…` / `NNb-…` | Cặp cùng chủ đề: **a** = bản theo khóa gốc (đọc trước), **b** = bản viết lại / API mới |
| `extra-…` | Bài phụ, bài tập — tùy chọn |
| `helpers/` | Module được các bài trong chương import, không chạy trực tiếp |
| `_shared/` | Module dùng chung nhiều track |

## Roadmap

Số chương trong `03-langchain` nhóm theo khóa gốc, **không hoàn toàn là thứ tự đọc** — đi theo các chặng dưới đây.

### Chặng 0 — LLM fundamentals · [00-llm-fundamentals/](00-llm-fundamentals/)
Học đầu tiên: hiểu model "đọc" và "viết" thế nào trước khi gọi API. Mỗi bài chạy độc lập bằng Gemini, comment đầu file ghi cả kết quả đo thật.

| Bài | Nội dung |
|---|---|
| `01-tokenization.js` | Token là gì, xem từng token, tiếng Anh / Việt có dấu / không dấu, schema trong prompt tốn bao nhiêu token |
| `02-sampling.js` | Model "bốc thăm" token: temperature, topK — và thực tế: temperature 0 vẫn không chắc giống nhau |

Khái niệm token sẽ gặp lại ở `01-sdk-basics/openai/02-count-tokens.js`; temperature gặp lại ở hầu hết bài sau.

### Chặng 1 — Gọi API thô · [01-sdk-basics/](01-sdk-basics/)
- `openai/`: chat completion cơ bản, đếm token (tiktoken).
- `gemini/`: JSON output → chatbot có history + cắt token → function calling thủ công → pipeline customer service.
- `huggingface/`: InferenceClient (chat, dịch, QA).

### Chặng 2 — Embedding từ con số 0 · [02-embeddings/](02-embeddings/)
`01-animal` → `02-movie` (embed → gợi ý phim bằng cosine) → `03-chroma` (vector DB, RAG tự viết, tìm ảnh bằng CLIP).

### Chặng 3 — LangChain cơ bản · thứ tự **01 → 02 → 03 → 07**
| Chương | Nội dung |
|---|---|
| [01-basics](03-langchain/01-basics/) | invoke/batch/stream, prompt template, output parser, chain vs model, chat history |
| [02-chains](03-langchain/02-chains/) | LLMChain, Sequential, Router — legacy (a) vs LCEL (b) |
| [03-memory](03-langchain/03-memory/) | buffer, window, token limit, summary |
| [07-qa](03-langchain/07-qa/) | RAG nhanh trên CSV + đánh giá (QAEvalChain). Là bản LangChain của `02-embeddings/03-chroma/02-rag-qa.js` |

Tham khảo: DeepLearning.AI *LangChain for LLM Application Development*.

### Chặng 4 — Chat with Your Data · thứ tự **04 → 05 → 06 → 08**
| Chương | Nội dung |
|---|---|
| [04-document-processing](03-langchain/04-document-processing/) | load PDF/web/YouTube, các loại splitter |
| [05-vectorstores-and-embeddings](03-langchain/05-vectorstores-and-embeddings/) | MemoryVectorStore (a) vs Chroma (b), failure modes |
| [06-retrieval](03-langchain/06-retrieval/) | MMR, metadata filter, self-query, compression, BM25 |
| [08-retrieval-qa](03-langchain/08-retrieval-qa/) | QA chain types (stuff/map_reduce/refine), conversational retrieval, CLI chatbot |

Tham khảo: *LangChain: Chat with Your Data*.

### Chặng 5 — Tools & Agents · thứ tự **09 → 10 → 11 → 12**
| Chương | Nội dung |
|---|---|
| [09-agent-from-scratch](03-langchain/09-agent-from-scratch/) | ReAct tự viết, native tool calling thủ công — bước đệm cho AgentExecutor (11/06) |
| [10-functions-tools-agents](03-langchain/10-functions-tools-agents/) | function calling, LCEL, tagging, extraction |
| [11-tool-routing](03-langchain/11-tool-routing/) | tool thật (thời tiết, Wikipedia, OpenAPI), routing, AgentExecutor (a) vs createAgent (b), chatbot |
| [12-agents](03-langchain/12-agents/) | agent cổ điển `@langchain/classic`: ReAct (a) vs tool calling (b). **Ôn tập, có thể bỏ qua** nếu đã nắm 09–11 |

Tham khảo: *Functions, Tools and Agents with LangChain*.

### Chặng 6 — LangGraph & long-term memory · thứ tự **13 → 14 → 15**
| Chương | Nội dung |
|---|---|
| [13-langgraph](03-langchain/13-langgraph/) | components, persistence, streaming, human-in-the-loop, sửa state, time travel — dựng graph tay (a) vs createAgent (b); essay writer; Send map-reduce |
| [14-email-assistant](03-langchain/14-email-assistant/) | triage + response agent, semantic / episodic / procedural memory, guardrails |
| [15-deep-agents](03-langchain/15-deep-agents/) | createDeepAgent: quickstart → essay writer bản deep agent |

Nhánh tùy chọn sau **14/04**: [04-typesafe/](04-typesafe/) — viết lại 14/01–04 bằng TypeSafe (import `helpers/` của chương 14).

Tham khảo: *AI Agents in LangGraph*, *Long-Term Agentic Memory with LangGraph*, LangChain docs (Deep Agents).

### Chặng 7 — Khóa Udemy · [05-udemy-course/](05-udemy-course/)
Các section đi theo thứ tự số; mỗi section chỉ cần học xong phần tiên quyết của nó:

| Section | Nội dung | Cần học trước |
|---|---|---|
| [01-agent-loop](05-udemy-course/01-agent-loop/) | Tự viết agent loop từ thấp lên cao: ReAct bằng text → tool calling thuần Ollama → `.bindTools` → `createAgent` + Tavily (04) | 03-langchain/09, 11 |
| [02-rag-mongodb](05-udemy-course/02-rag-mongodb/) | Tavily Map/Extract → nạp tài liệu vào MongoDB Atlas → so sánh 4 cách hỏi đáp (không RAG, RAG tay, LCEL, agentic) | Chặng 4 |
| [03-langgraph-agents](05-udemy-course/03-langgraph-agents/) | ReAct bằng StateGraph → Reflection → Reflexion (search + trích dẫn) → Human-in-the-loop (checkpoint Postgres) → Chat nhớ theo thread (Postgres) → Chạy song song nhiều nhánh (fan-out/fan-in) → Chọn nhánh song song bằng router → Xung đột state khi chạy song song | 03-langchain/13 |
| [04-agentic-rag](05-udemy-course/04-agentic-rag/) | Adaptive/corrective RAG: router, grader, web search fallback. Chạy `main.js` | Section 02, 03 |
| [05-mcp](05-udemy-course/05-mcp/) | MCP client + agent, server stdio (math) và SSE (weather). Chạy `main.js` | 03-langchain/11 |

Ảnh graph của section 03, 04 được ghi vào `images/graphs/`.

### Chặng 8 — Improving Accuracy of LLM Applications · [06-improving-accuracy/](06-improving-accuracy/)
Bản gốc dùng Lamini + Llama 3 8B; bài 01 dùng Ollama `qwen3` local (`raw: true` để tự viết template). Các bài sau dùng Gemini (máy không đủ mạnh chạy model local cho vòng lặp eval).

| Bài | Nội dung | Cần học trước |
|---|---|---|
| `01-llama3-basics.js` | Template Llama 3 vs ChatML (Qwen3), sinh SQL độ khó tăng dần → thấy model bịa cú pháp | Chặng 0 |
| `extra-self-consistency.js` | Bài phụ: hỏi N lần đo độ đồng thuận để phát hiện model bịa; giới hạn: sai nhất quán | 01, `00/02-sampling` |
| `extra-context-window.js` | Bài phụ: mò kim đáy bể trên schema 20 → 1000 bảng — độ chính xác, token, độ trễ | `00/01-tokenization` |

Fine-tune Qwen3 (sinh data → train trên Colab → Ollama → chấm điểm): [06-improving-accuracy/FINETUNE.md](06-improving-accuracy/FINETUNE.md).

Project áp dụng sau khóa: [plans/text-to-sql-nestjs.md](plans/text-to-sql-nestjs.md) (repo riêng, NestJS + Postgres).

Tham khảo: DeepLearning.AI *Improving Accuracy of LLM Applications*. Context lộ trình học: [LEARNING-CONTEXT.md](LEARNING-CONTEXT.md).

## Service & key theo phần

| Phần | Cần |
|---|---|
| Hầu hết bài | `GEMINI_API_KEY` |
| `01-sdk-basics/openai`, `14/07-security-guardrails` | `OPENAI_API_KEY` |
| `01-sdk-basics/huggingface` | `HUGGINGFACE_ACCESS_TOKEN` |
| `02-embeddings/03-chroma`, `05/02b-vectorstore-chroma` | Chroma: `docker run -d -p 8000:8000 chromadb/chroma` |
| `05-udemy-course/04-agentic-rag` | Chroma: `npx chroma run --path ./chroma-data`, `TAVILY_API_KEY` |
| `15-deep-agents`, `05-udemy-course` (01/04, 02, 03, 04) | `TAVILY_API_KEY` |
| `04-typesafe` | `TYPESAFE_API_KEY` |
| `05-udemy-course/01-agent-loop` 01–03, `06-improving-accuracy` | Ollama + model `qwen3` (`OLLAMA_BASE_URL`) |
| `05-udemy-course/02-rag-mongodb` | MongoDB Atlas Vector Search (`MONGODB_*`, `INDEX_NAME`) |
| `05-udemy-course/03-langgraph-agents/04`, `05` | Postgres: `docker run -d --name langgraph-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17-alpine`, `POSTGRES_URI`. Bài 04 không cần API key, bài 05 cần `GEMINI_API_KEY` |
| Tracing (tùy chọn) | `LANGSMITH_*` |

Lưu ý:
- **Chroma và MCP weather-server đều dùng cổng 8000** — không chạy cùng lúc.
- `03-image-search.js` chỉ đọc `images/samples/`. Nếu collection `image-search` từng index ảnh graph, hãy xóa collection rồi chạy lại.
- Một số package được dùng trong code nhưng chỉ có qua dependency gián tiếp (chưa khai báo trong `package.json`): `ollama`, `zod`, `zod-to-json-schema`, `@langchain/langgraph`, `@langchain/openai`, `@huggingface/transformers`.
- `_shared/polyfill.js` bổ sung `globalThis.crypto` cho Node 18 — các bài require nó ở dòng đầu.
