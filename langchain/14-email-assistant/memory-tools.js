// 2 tool để Agent quản lý memory:
// - manage_memory: lưu, cập nhật, xoá.
// - search_memory: tìm memory.
//
// Cả 2 dùng chung một InMemoryStore.
// getStore(config) lấy Store được gắn vào Agent/Graph.

require("../_polyfill");

const { randomUUID } = require("crypto");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { getStore } = require("@langchain/langgraph");

// Thay placeholder bằng user id từ config.
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

      // Bọc try/catch: lỗi Store (mất kết nối, embedding API lỗi...) trả về
      // thành message cho LLM đọc, thay vì throw làm crash cả Agent.
      // switch khớp 1-1 với 3 giá trị của enum action - thêm action mới sẽ
      // buộc phải thêm case tương ứng, khó bỏ sót hơn if-chain.
      try {
        switch (action) {
          case "delete": {
            if (!id) return "Cần cung cấp `id` để xoá memory.";

            await store.delete(namespace, id);

            return `Deleted memory ${id}`;
          }

          case "update": {
            if (!id) return "Cần cung cấp `id` để cập nhật memory đã có.";

            await store.put(namespace, id, { content });

            return `Updated memory ${id}: ${content}`;
          }

          case "create": {
            const key = id ?? randomUUID();

            await store.put(namespace, key, { content });

            return `Created memory ${key}: ${content}`;
          }
        }
      } catch (error) {
        return `Thao tác memory thất bại: ${error.message}`;
      }
    },
    {
      name: "manage_memory",
      description:
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

      try {
        const results = await store.search(namespace, { query, limit });

        console.log(
          `[search_memory] query="${query}" namespace=${namespace.join("/")} -> ${results.length} kết quả`,
        );

        if (results.length === 0) return "No memories found.";

        // Kết quả đã được xếp theo độ liên quan - không gọi lại tool này nữa
        // trong cùng 1 email, dù kết quả rỗng hay chưa ưng ý.
        const list = results
          .map((item) => `- [${item.key}] ${item.value.content}`)
          .join("\n");

        return `Most relevant memories found:\n${list}`;
      } catch (error) {
        return `Tìm memory thất bại: ${error.message}`;
      }
    },
    {
      name: "search_memory",
      description:
        "Search your long-term memories for information relevant to the current context. " +
        "Results are ranked by relevance - call this tool at most once per email and use " +
        "whatever it returns as final.",
      schema: z.object({
        query: z.string().describe("Nội dung cần tìm trong memory"),
        limit: z.number().optional().describe("Số lượng kết quả tối đa"),
      }),
    },
  );
}

module.exports = {
  createManageMemoryTool,
  createSearchMemoryTool,
};
