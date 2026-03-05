/**
 * title-generator.ts — AI-powered session title generation via SDK.
 *
 * Uses the same SDK query() path as normal chat, routed through Global Sidecar.
 * Single-turn, non-persistent session — lightweight and fully verified.
 */

import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveClaudeCodeCli, buildClaudeSessionEnv, type ProviderEnv } from './agent-session';

const TITLE_MAX_LENGTH = 30;
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You are a conversation title generator. Your ONLY job is to output a short title.

Rules:
- Output ONLY the title text, nothing else — no quotes, no punctuation wrapper, no explanation
- Maximum 30 characters (CJK counts as 1 each)
- The title language MUST match the primary language of the conversation (e.g. Chinese conversation → Chinese title, English → English, mixed → follow the user's language)
- Capture the core topic or intent, not surface keywords
- Prefer nouns/verbs over vague words like "help", "question", "discussion"`;

function buildUserPrompt(userMessage: string, assistantReply: string): string {
  return `<user_message>\n${userMessage.slice(0, 500)}\n</user_message>\n\n<assistant_reply>\n${assistantReply.slice(0, 500)}\n</assistant_reply>`;
}

/**
 * Clean up the generated title: remove surrounding quotes, punctuation, whitespace,
 * and truncate to TITLE_MAX_LENGTH characters.
 */
function cleanTitle(raw: string): string {
  let cleaned = raw.trim();
  // Remove surrounding quotes (single, double, Chinese quotes)
  cleaned = cleaned.replace(/^["'「『《【"']+|["'」』》】"']+$/g, '');
  // Remove trailing punctuation
  cleaned = cleaned.replace(/[。，、；：！？.,:;!?…]+$/, '');
  // Remove common AI preamble patterns
  cleaned = cleaned.replace(/^(标题[：:]|Title[：:])\s*/i, '');
  cleaned = cleaned.trim();
  if (cleaned.length > TITLE_MAX_LENGTH) {
    cleaned = cleaned.slice(0, TITLE_MAX_LENGTH);
  }
  return cleaned;
}

/**
 * Generate a short session title using the SDK query() path.
 * Uses the user's current model and provider — single-turn, non-persistent.
 * Returns cleaned title string on success, null on any failure (silent).
 */
export async function generateTitle(
  userMessage: string,
  assistantReply: string,
  model: string,
  providerEnv?: ProviderEnv,
): Promise<string | null> {
  const startTime = Date.now();
  const sessionId = randomUUID();

  try {
    const cliPath = resolveClaudeCodeCli();
    const cwd = join(homedir(), '.myagents', 'projects');
    mkdirSync(cwd, { recursive: true });

    const env = buildClaudeSessionEnv(providerEnv);
    const prompt = buildUserPrompt(userMessage, assistantReply);

    async function* titlePrompt() {
      yield {
        type: 'user' as const,
        message: { role: 'user' as const, content: prompt },
        parent_tool_use_id: null,
        session_id: sessionId,
      };
    }

    const titleQuery = query({
      prompt: titlePrompt(),
      options: {
        maxTurns: 1,
        sessionId,
        cwd,
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        executable: 'bun',
        env,
        systemPrompt: SYSTEM_PROMPT,
        includePartialMessages: false,
        persistSession: false,
        mcpServers: {},
        ...(model ? { model } : {}),
      },
    });

    let titleText: string | null = null;

    // Race: SDK response vs timeout
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const queryPromise = (async (): Promise<string | null> => {
      for await (const message of titleQuery) {
        if (message.type === 'assistant') {
          const msg = message as { message?: { content?: Array<{ text?: string }> } };
          const text = msg.message?.content?.[0]?.text;
          if (text) return text;
        }
        // result type — extract from last assistant message if available
        if (message.type === 'result') {
          const resultMsg = message as { subtype?: string; messages?: Array<{ role: string; content?: Array<{ text?: string }> }> };
          if (resultMsg.subtype === 'success' && resultMsg.messages) {
            const lastAssistant = resultMsg.messages.filter(m => m.role === 'assistant').pop();
            const text = lastAssistant?.content?.[0]?.text;
            if (text) return text;
          }
        }
      }
      return null;
    })();

    titleText = await Promise.race([queryPromise, timeoutPromise]);

    // If timeout won, terminate the SDK iterator to release the subprocess
    if (titleText === null) {
      try { titleQuery.return(undefined as never); } catch { /* ignore */ }
    }

    if (!titleText) {
      console.warn(`[title-generator] No title text returned (${Date.now() - startTime}ms)`);
      return null;
    }

    const cleaned = cleanTitle(titleText);
    console.log(`[title-generator] Generated title: "${cleaned}" (${Date.now() - startTime}ms)`);
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    console.warn('[title-generator] SDK query failed:', err);
    return null;
  }
}
