/**
 * OpenCode HTTP client — zero-dependency wrapper around opencode serve API.
 *
 * Uses native fetch (Node 18+) and SSE parsing for event streams.
 */

/**
 * Create an OpenCode HTTP client connected to a running server.
 * @param {{ baseUrl: string }} opts
 */
export function createClient(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");

  async function request(method, path, body) {
    const url = `${base}${path}`;
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenCode API ${method} ${path}: ${res.status} ${text}`);
    }
    // 204 No Content
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  /**
   * Subscribe to SSE event stream.
   * Returns an async iterator of parsed events: { type, properties }.
   */
  async function* subscribeEvents(path = "/event") {
    const url = `${base}${path}`;
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok) {
      throw new Error(`SSE connect failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent.type = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          try {
            const parsed = JSON.parse(data);
            // opencode sends all fields in data JSON: {type, properties, ...}
            // Merge into currentEvent, but prefer explicit event: line if present
            if (parsed && typeof parsed === "object") {
              if (!currentEvent.type && parsed.type) {
                currentEvent.type = parsed.type;
              }
              currentEvent.properties = parsed.properties || parsed;
            } else {
              currentEvent.properties = parsed;
            }
          } catch {
            currentEvent.properties = data;
          }
        } else if (line === "") {
          // Empty line = end of event
          if (currentEvent.type || currentEvent.properties) {
            yield currentEvent;
            currentEvent = {};
          }
        }
      }
    }
  }

  return {
    /** Health check */
    health: () => request("GET", "/global/health"),

    /** Session management */
    session: {
      list: () => request("GET", "/session"),
      create: (body) => request("POST", "/session", body),
      get: (id) => request("GET", `/session/${id}`),
      delete: (id) => request("DELETE", `/session/${id}`),
      abort: (id) => request("POST", `/session/${id}/abort`),
      messages: (id) => request("GET", `/session/${id}/message`),
      status: () => request("GET", "/session/status"),

      /**
       * Send a prompt (synchronous — waits for full response).
       * @param {string} id - session ID
       * @param {object} body - { parts: [{ type: "text", text: "..." }], model?, agent? }
       */
      prompt: (id, body) => request("POST", `/session/${id}/message`, body),

      /**
       * Send a prompt asynchronously (returns immediately, 204).
       * Listen to events for progress.
       */
      promptAsync: (id, body) =>
        request("POST", `/session/${id}/prompt_async`, body),
    },

    /** Config */
    config: {
      get: () => request("GET", "/config"),
    },

    /** Events */
    events: {
      subscribe: () => subscribeEvents("/event"),
      subscribeGlobal: () => subscribeEvents("/global/event"),
    },

    /** Raw request for anything else */
    request,
  };
}
