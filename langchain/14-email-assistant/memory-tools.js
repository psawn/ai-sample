// 2 Tool để LLM tự quản lý bộ nhớ dài hạn: manage_memory (lưu) và search_memory (tra cứu).
// Cả 2 đọc/ghi chung 1 InMemoryStore của @langchain/langgraph.
//
// getStore(config) lấy đúng Store đã được gắn cho Agent/Graph lúc invoke() (qua option
// `store` khi tạo agent hoặc compile graph) - nhờ vậy Tool không cần nhận Store qua tham
// số riêng, LLM chỉ cần gọi tool với đúng input là dùng được ngay.

require("../_polyfill");

const { randomUUID } = require("crypto");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { getStore } = require("@langchain/langgraph");

// Namespace có thể chứa placeholder "{langgraph_user_id}" - hàm này thay nó bằng user id
// thật lấy từ config.configurable của lượt invoke() hiện tại, để mỗi user có vùng nhớ riêng.
function resolveNamespace(namespaceTemplate, config) {
  const userId = config?.configurable?.langgraph_user_id ?? "default";
  return namespaceTemplate.map((part) =>
    part === "{langgraph_user_id}" ? userId : part,
  );
}

function createManageMemoryTool(namespaceTemplate) {
  return tool(
    async ({ content, action = "create", id }, config) => {
      const store = getStore(config);
      const namespace = resolveNamespace(namespaceTemplate, config);
      console.log(
        `[manage_memory] action=${action} id=${id ?? "(new)"} namespace=${namespace.join("/")} content=${content}`,
      );

      if (action === "delete") {
        if (!id) return "Cần cung cấp `id` để xoá memory.";
        await store.delete(namespace, id);
        return `Deleted memory ${id}`;
      }

      // Không có id -> tạo memory mới với id ngẫu nhiên; có id -> ghi đè memory cũ (update).
      const key = id ?? randomUUID();
      await store.put(namespace, key, { content });
      return `${action === "create" ? "Created" : "Updated"} memory ${key}: ${content}`;
    },
    {
      name: "manage_memory",
      description:
        // Không dùng chữ "persistent": InMemoryStore chỉ tồn tại trong RAM của tiến trình
        // hiện tại, mất hết khi restart - "persistent" dễ khiến hiểu nhầm là lưu vĩnh viễn.
        "Create, update, or delete a memory that can be reused across conversations in " +
        "this run. Omit `id` when creating a new memory; include it to update or delete " +
        "an existing one.",
      schema: z.object({
        content: z.string().describe("Nội dung của memory cần lưu"),
        action: z
          .enum(["create", "update", "delete"])
          .default("create")
          .describe("Hành động: tạo mới, cập nhật, hoặc xoá memory"),
        id: z.string().optional().describe("Id của memory cần update/delete"),
      }),
    },
  );
}

function createSearchMemoryTool(namespaceTemplate) {
  return tool(
    async ({ query, limit = 10 }, config) => {
      const store = getStore(config);
      const namespace = resolveNamespace(namespaceTemplate, config);

      const results = await store.search(namespace, { query, limit });
      console.log(
        `[search_memory] query="${query}" namespace=${namespace.join("/")} -> ${results.length} kết quả`,
      );
      if (results.length === 0) return "No memories found.";

      // Nói rõ đây đã là top kết quả liên quan nhất, để LLM không gọi lại tool này nhiều
      // lần với các từ khóa khác nhau cho "chắc" (nguyên nhân gây GraphRecursionError khi
      // xử lý followUpEmail - xem lịch sử debug ở 04-memory-agent.js).
      const list = results.map((item) => `- [${item.key}] ${item.value.content}`).join("\n");
      return `Most relevant memories found (no need to retry with other keywords):\n${list}`;
    },
    {
      name: "search_memory",
      description:
        "Search your long-term memories for information relevant to the current context. " +
        "Returns the most relevant matches in a single call - retrying with different " +
        "keywords won't surface better results.",
      schema: z.object({
        query: z.string().describe("Nội dung cần tìm trong memory"),
        limit: z.number().optional().describe("Số lượng kết quả tối đa"),
      }),
    },
  );
}

module.exports = { createManageMemoryTool, createSearchMemoryTool };
