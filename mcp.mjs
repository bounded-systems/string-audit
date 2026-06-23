#!/usr/bin/env node
// MCP stdio server — projects the verb registry (verbs.mjs) to Model Context Protocol
// tools, so an agent can call `audit` / `extract` as tools over the same typed contract
// the CLI uses. Thin: `tools/list` returns verbspec's MCP toolset; `tools/call` validates
// arguments against the verb's Zod input (the single validation, exactly as the CLI's
// parseArgs does) and runs it. Line-delimited JSON-RPC 2.0 over stdin/stdout.
//
//   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp.mjs
//   { "command": "node", "args": ["mcp.mjs"] }   # an MCP host's server config
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toMcpToolset, verbToken } from "@bounded-systems/verbspec";
import { registry } from "./verbs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
const PROTOCOL = "2024-11-05";
const tools = toMcpToolset(registry);
const byName = new Map(Object.values(registry).map((v) => [verbToken(v.id), v]));

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const errContent = (id, text) => ok(id, { isError: true, content: [{ type: "text", text }] });

async function handle(req) {
  const { id, method, params } = req;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "string-audit", version },
      });
    case "tools/list":
      return ok(id, { tools });
    case "tools/call": {
      const v = byName.get(params?.name);
      if (!v) return fail(id, -32602, `unknown tool: ${params?.name}`);
      const parsed = v.input.safeParse(params?.arguments ?? {});
      if (!parsed.success) return errContent(id, `invalid arguments: ${JSON.stringify(parsed.error.issues)}`);
      // A verb may set deep env knobs (STORE / AUDIT_VALE) from its args; snapshot + restore
      // so one tool call's config can't leak into the next in this long-lived server.
      const env = { ...process.env };
      try {
        const output = await v.run(/** @type {any} */ (parsed.data), v.deps?.()); // registry erases per-verb input types
        return ok(id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] });
      } catch (e) {
        return errContent(id, String(e?.message ?? e));
      } finally {
        for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
        Object.assign(process.env, env);
      }
    }
    default:
      // notifications (no id, e.g. notifications/initialized) get no reply.
      return id === undefined || id === null ? null : fail(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  const t = line.trim();
  if (!t) continue;
  let req;
  try {
    req = JSON.parse(t);
  } catch {
    process.stdout.write(JSON.stringify(fail(null, -32700, "parse error")) + "\n");
    continue;
  }
  const res = await handle(req);
  if (res) process.stdout.write(JSON.stringify(res) + "\n");
}
