# CONTEXT — LỘ TRÌNH HỌC AI ENGINEER

**Cập nhật: 03/11/2026**

## 1. Nền tảng hiện tại

- Vị trí: Fullstack Developer, chủ yếu sử dụng **Node.js, TypeScript và NestJS**.
- Kiến thức nền tảng: Backend, database, cloud và DevOps.
- Đã đạt 5 chứng chỉ AWS:
  1. Cloud Practitioner
  2. Solutions Architect – Associate
  3. Solutions Architect – Professional
  4. Developer – Associate
  5. DevOps Engineer – Professional
- Sẵn sàng học và dùng Python khi cần cho AI Engineering.

## 2. Mục tiêu nghề nghiệp

Tôi hướng tới các vị trí:

- Applied AI Engineer
- Generative AI Engineer
- Agentic AI Engineer

Mục tiêu là xây dựng, đánh giá, bảo mật và triển khai các ứng dụng AI thực tế lên production.

Tôi không tập trung vào nghiên cứu ML chuyên sâu hoặc tự huấn luyện foundation model từ đầu. Tôi muốn tận dụng kiến thức backend, database, cloud và DevOps hiện có để phát triển các hệ thống AI đáng tin cậy.

## 3. Các khóa học đã hoàn thành

Tổng cộng: **11 khóa học**.

### DeepLearning.AI — 8 khóa

1. ChatGPT Prompt Engineering for Developers — https://www.deeplearning.ai/courses/chatgpt-prompt-eng
2. Building Systems with the ChatGPT API — https://www.deeplearning.ai/courses/chatgpt-building-system
3. LangChain for LLM Application Development — https://www.deeplearning.ai/courses/langchain
4. LangChain: Chat with Your Data — https://www.deeplearning.ai/courses/langchain-chat-with-your-data
5. Functions, Tools and Agents with LangChain — https://www.deeplearning.ai/courses/functions-tools-agents-langchain
6. AI Agents in LangGraph — https://www.deeplearning.ai/courses/ai-agents-in-langgraph
7. Long-Term Agentic Memory With LangGraph — https://www.deeplearning.ai/courses/long-term-agentic-memory-with-langgraph
8. Improving Accuracy of LLM Applications — https://www.deeplearning.ai/courses/improving-accuracy-of-llm-applications
   (Text-to-SQL agent, evaluation, self-reflection, fine-tuning LoRA/memory tuning)

### Udemy — 3 khóa

9. Generative AI for NodeJS: OpenAI, LangChain - TypeScript — Alex Dan — https://www.udemy.com/course/generative-ai-for-nodejs-openai-langchain/
10. LangChain: Agentic AI Engineering with LangChain & LangGraph — Eden Marco — https://www.udemy.com/course/langchain/
11. LangGraph – Develop LLM powered AI agents with LangGraph — Eden Marco — https://www.udemy.com/course/langgraph/

## 4. Khóa học đang học

**AI Security Bootcamp – Guardrails, LLM Gateways, Observability** — Udemy, KRISHAI / Krish Naik (bắt đầu 03/11/2026)

Trang khóa học: https://www.udemy.com/course/ai-security-bootcamp-guardrailsllm-gatewaysobservability/

- Nội dung chính: guardrails (NeMo, Guardrails AI, AWS Bedrock Guardrails), LLM gateway (Portkey, TensorZero, Bifrost), observability (LangSmith, Pydantic Logfire), eval (DeepEval), red teaming (PyRIT).
- Học phần nào, bỏ phần nào: xem mục 6, "Bước 1".
- Khóa này chưa được tính là hoàn thành cho đến khi tôi xác nhận.

## 5. Những mảng kiến thức cần ưu tiên

### Ưu tiên 1 — AI Security / LLM Security và Agent Security

Bảo vệ ứng dụng LLM và AI Agent trong môi trường thực tế, không chỉ học các mẹo prompt engineering cơ bản.

- Direct và indirect prompt injection.
- Jailbreak và instruction hierarchy.
- Bảo mật RAG, ngăn truy xuất trái phép và rò rỉ dữ liệu.
- Bảo mật tool calling và MCP.
- Authentication, authorization, least privilege và giới hạn quyền của agent.
- Rủi ro từ SQL do LLM sinh ra; phân biệt SQL injection truyền thống với các rủi ro liên quan đến LLM.
- Read-only database access, SQL validation, table/column allowlists, row-level security, timeout và giới hạn tài nguyên.
- Bảo vệ PII và secrets.
- Threat modeling, red teaming, security testing, audit logs, monitoring và defense in depth.

### Ưu tiên 2 — Production AI Engineering / LLMOps

- Đánh giá chất lượng LLM và AI Agent; chạy eval trong CI.
- Observability, tracing và debugging.
- LLM gateway: fallback, rate limit, cache, kiểm soát chi phí.
- Reliability và xử lý lỗi.
- Tối ưu latency, throughput và chi phí.
- Deployment và kiến trúc production.
- Monitoring và cải thiện chất lượng liên tục.

### Ưu tiên 3 — Advanced RAG và Database Agents

Advanced RAG:

- Hybrid search (kết hợp kết quả bằng RRF), reranking bằng cross-encoder.
- Chunking nâng cao, query transformation.
- Đo chất lượng retrieval (recall@k, MRR) và RAG eval (faithfulness, context precision/recall).

Text-to-SQL và Database Agents (ưu tiên áp dụng với PostgreSQL và backend TypeScript/NestJS):

- Kiến trúc Text-to-SQL và Database Agent.
- Schema retrieval và schema linking.
- Sinh SQL phức tạp: JOIN, subquery và truy vấn phân tích dữ liệu.
- Xử lý câu hỏi mơ hồ và hỏi lại người dùng khi cần.
- Kiểm tra SQL, thực thi truy vấn, xử lý lỗi và tự sửa truy vấn.
- Bộ dữ liệu đánh giá, execution accuracy và phân tích lỗi.
- Tối ưu hiệu năng, latency, độ tin cậy và chi phí.
- Phân quyền database, kiểm soát truy vấn và ngăn chặn thao tác không an toàn.

### Các chủ đề quan tâm khác

- AI Agent, tool calling và multi-agent systems.
- Agent memory và context engineering.
- MCP và các giao thức kết nối agent.
- Local LLM và open-source LLM.

## 6. Lộ trình tiếp theo (chọn ngày 03/11/2026)

Chọn dựa trên đối chiếu repo `d:\Test\ai` với các khóa hiện có trên thị trường tại ngày 03/11/2026.

### Khoảng trống thấy được từ repo (tại 03/11/2026)

| Mảng | Đã có trong repo | Còn thiếu |
|---|---|---|
| Security | 1 bài `03-langchain/14-email-assistant/07-security-guardrails.js` (LLM phát hiện injection, moderation, PII, giới hạn quyền tool). Kế hoạch `plans/text-to-sql-nestjs.md` đã thiết kế RLS, role chỉ đọc, chặn `set_config` | Threat model, indirect injection qua RAG/tool, red teaming tự động, guardrail framework thật, đo hiệu quả guardrail |
| LLMOps | Eval tự viết: gold set, LLM-as-judge, so sánh trước/sau fine-tune (`06-improving-accuracy/04-evaluation.js`). LangSmith chỉ là tùy chọn | Nền tảng observability chuyên dụng, eval trong CI, LLM gateway |
| Advanced RAG | MMR, self-query, compression, BM25, corrective/adaptive RAG | Hybrid + RRF, cross-encoder rerank, đo retrieval, RAG eval production |
| Database Agent | Text-to-SQL, eval, fine-tune; kế hoạch NestJS chi tiết | Thiếu thực hành, không thiếu khóa học |

### Thứ tự học

| # | Việc | Trạng thái |
|---|---|---|
| 1 | AI Security Bootcamp – Guardrails, LLM Gateways, Observability (Udemy, KRISHAI / Krish Naik) — https://www.udemy.com/course/ai-security-bootcamp-guardrailsllm-gatewaysobservability/ | **Đang học** (từ 03/11/2026) |
| 2 | Làm `plans/text-to-sql-nestjs.md`, áp dụng kiến thức của bước 1 vào Level 2 (validator) và Level 8 (tracing) | Chưa bắt đầu |
| 3 | Retrieval Augmented Generation (RAG) — DeepLearning.AI trên Coursera, Zain Hasan — https://www.coursera.org/learn/retrieval-augmented-generation-rag | Chưa bắt đầu |

### Bước 1 — AI Security Bootcamp: học phần nào

Thông tin kiểm tra ngày 03/11/2026: 83h10m, 279 bài, 32 section, cập nhật 10/2026, 4.6★ (373 đánh giá), Python. Trang Udemy chỉ hiện 10/32 section; tên các section gateway, DeepEval, PyRIT lấy từ kết quả tìm kiếm.

| Section | Cách học |
|---|---|
| Langchain (3h09m), Building AI Agents With LangGraph (3h39m) | Bỏ qua |
| Observability with Langsmith (1h30m) | Xem lướt |
| Observability With Pydantic Logfire (1h54m) | Không bắt buộc |
| Nemo Guardrails (2h25m) / Guardrails AI (3h04m) | Chọn 1 |
| AWS Bedrock Guardrails (4h24m) | Học kỹ (gọi được qua AWS SDK từ NestJS) |
| LLM Gateways + 1 trong Portkey / TensorZero / Bifrost | Học kỹ phần giới thiệu và 1 gateway |
| Deep Eval | Học kỹ, so với `04-evaluation.js` |
| Red Teaming with PyRIT (~5h) | Học kỹ |

### Bước 3 — Khóa RAG trên Coursera: học phần nào

- Học: Module 2 (hybrid search, đo retrieval), Module 3 (chunking nâng cao, cross-encoder, ColBERT, reranking), Module 5 (RAG production: eval, tracing, chi phí/độ trễ, security).
- Bỏ: Module 1, Module 4 (trùng RAG cơ bản, sampling, prompt engineering, agentic RAG).

### Đã cân nhắc nhưng không chọn lúc này (03/11/2026)

- AI Engineer Production Track (Ed Donner): phần lớn là AWS/Terraform/CI đã biết.
- Ultimate AI/LLM/ML Penetration Testing (Martin Voelk): góc nhìn tấn công, không dạy xây hệ thống an toàn. Có thể học thêm vài section nếu muốn đi sâu red teaming.
- Building Your Own Database Agent (DeepLearning.AI): trùng Text-to-SQL đã học.
- Các khóa ngắn Red Teaming, Guardrails, Governing AI Agents (DeepLearning.AI): mức beginner, chỉ nên xem nhanh.

Danh sách này không phải quyết định loại bỏ vĩnh viễn (xem mục 8, quy tắc 9–10).

## 7. Phong cách học mong muốn

- Ưu tiên khóa học thực hành, có project và hướng dẫn triển khai thay vì chỉ trình bày lý thuyết.
- Ưu tiên Udemy và DeepLearning.AI; có thể chọn Coursera, Educative hoặc nền tảng khác nếu chất lượng tốt hơn rõ rệt.
- Quan tâm đến giá; không ưu tiên khóa quá đắt nếu không có lợi ích vượt trội.
- Không cần học lại kiến thức LangChain, LangGraph, Agent và RAG cơ bản.
- Ưu tiên kiến thức có thể áp dụng vào production, bao gồm testing, evaluation, security và các đánh đổi trong thiết kế hệ thống.
- Xây dựng lộ trình theo thứ tự hợp lý, hạn chế học trùng lặp.
- Giải thích bằng tiếng Việt, rõ ràng, dễ hiểu, đi thẳng vào vấn đề.
- Không bắt buộc phải có một milestone project sau mỗi giai đoạn.
- Ưu tiên tận dụng nền tảng TypeScript/NestJS, nhưng không loại trừ khóa học Python nếu khóa đó thực sự đáng học.

## 8. Nguyên tắc tìm kiếm và đề xuất khóa học

Khi đề xuất khóa học:

1. Chủ động tìm các khóa học hiện có, không chỉ dựa vào danh sách hoặc đề xuất cũ.
2. Không đề xuất khóa học chỉ vì phổ biến hoặc rating cao.
3. Kiểm tra syllabus thực tế, nội dung, thời lượng và mức độ cập nhật.
4. So sánh với các khóa đã hoàn thành và với code trong repo để xác định phần trùng lặp và giá trị kiến thức mới.
5. Nếu khóa dài, chỉ rõ phần nào nên học kỹ, phần nào có thể bỏ qua.
6. Phân biệt thông tin đã xác minh với nhận định cá nhân.
7. Giải thích khóa học giải quyết khoảng trống kiến thức nào, tại sao phù hợp và còn thiếu những gì.
8. Không bịa tên khóa học, URL, syllabus, review hoặc rating.
9. Không mặc định khóa từng được cân nhắc là đã chọn, đã từ chối vĩnh viễn hoặc đã hoàn thành.
10. Không để danh sách khóa học cũ giới hạn việc tìm kiếm các lựa chọn tốt hơn.

## 9. Cách cập nhật file này

Mỗi khi tôi báo đã học xong một khóa:

1. Chuyển khóa đó sang mục 3 (Đã hoàn thành), cập nhật tổng số khóa.
2. Cập nhật trạng thái trong bảng "Thứ tự học" ở mục 6 và mục 4 (Đang học).
3. Xem lại code trong repo, cập nhật bảng "Khoảng trống thấy được từ repo" ở mục 6.
4. Cập nhật ngày ở đầu file.
5. Nếu khóa tiếp theo trong lộ trình không còn phù hợp (khóa mới tốt hơn, khoảng trống đã thay đổi), báo cho tôi trước khi sửa lộ trình.

**Mục tiêu cuối cùng:** Có khả năng thiết kế, xây dựng, đánh giá, bảo mật và triển khai ứng dụng AI đạt chất lượng production, tận dụng lợi thế từ kinh nghiệm fullstack, database, cloud và DevOps hiện có.
