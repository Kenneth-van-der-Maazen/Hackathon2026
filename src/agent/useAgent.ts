import { useRef, useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_TOOLS, executeTool } from "./tools";
import type { ToolContext } from "./tools";

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
});

const SYSTEM_PROMPT = `You are an intelligent cash-flow and operations analyst for Altis Groep, a Dutch roofing contractor acquisition holding company. You assist CFOs, operating company managers, and data teams with financial forecasts, project risk, and weather impact.

You have tools to query live forecast data, WIP projects, weather insights, covenant status, and portfolio revenue. Use them proactively to give data-driven answers — always fetch data before summarising.

Company context:
- Altis Groep has 4 subsidiaries: Daken van Winschoten (Groningen), Dakbedekking Andijk (Noord-Holland), Peter Ummels Dakbedekkingen (Limburg/Brunssum), Roofing Heeze (Noord-Brabant)
- Revenues and cash flow figures are in EUR
- Forecast is weekly; scenarios are Base, Wet Quarter (heavy rain → fewer site days → delayed billing), Dry Quarter (favourable weather)
- Primary cash inflow: milestone billing; primary outflows: materials and subcontractors
- Bank covenants require interest coverage ≥ 2.0× and minimum liquidity headroom

Response style:
- Be concise and precise — executives prefer numbers over lengthy prose
- Lead with the most important figure or risk, then provide supporting detail
- When drafting external communications (board updates, bank memos, project manager briefs), match the appropriate tone and include key numbers
- If data is unavailable or partially loaded, acknowledge it and give what you can`;

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  isError?: boolean;
}

export function useAgent(ctx: ToolContext) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const historyRef = useRef<Anthropic.MessageParam[]>([]);

  async function sendMessage(userText: string) {
    if (!userText.trim() || isLoading) return;

    const userMsg: DisplayMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      content: userText.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    historyRef.current = [
      ...historyRef.current,
      { role: "user", content: userText.trim() },
    ];

    setIsLoading(true);
    const toolsUsedThisTurn: string[] = [];

    try {
      let continueLoop = true;

      while (continueLoop) {
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: AGENT_TOOLS,
          messages: historyRef.current,
        });

        historyRef.current = [
          ...historyRef.current,
          { role: "assistant", content: response.content },
        ];

        if (response.stop_reason === "tool_use") {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === "tool_use") {
              if (!toolsUsedThisTurn.includes(block.name)) {
                toolsUsedThisTurn.push(block.name);
              }
              const result = executeTool(
                block.name,
                block.input as Record<string, unknown>,
                ctx
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          historyRef.current = [
            ...historyRef.current,
            { role: "user", content: toolResults },
          ];
        } else {
          const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n\n")
            .trim();

          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-a`,
              role: "assistant",
              content: text || "(no response)",
              toolsUsed: toolsUsedThisTurn.length > 0 ? [...toolsUsedThisTurn] : undefined,
            },
          ]);
          continueLoop = false;
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-e`,
          role: "assistant",
          content: `Something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`,
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function clearMessages() {
    setMessages([]);
    historyRef.current = [];
  }

  return { messages, isLoading, sendMessage, clearMessages };
}
