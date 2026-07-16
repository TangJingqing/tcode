export function buildCompactSummaryPrompt(conversationText: string): string {
  return `You are summarizing a conversation for context compression.
Produce a structured summary in <summary> tags.

Sections:
1. Primary Request — What the user asked for
2. Key Decisions — Important choices made
3. Files Modified — Which files were changed and why
4. Errors Encountered — Problems hit and how they were resolved
5. Current State — Where things stand right now
6. Pending Tasks — What still needs to be done

Rules:
- Be concise but preserve actionable details (file paths, command outputs, error messages)
- Use <analysis> tags as scratchpad, then <summary> tags for final output
- The summary will replace all messages before the recent tail

Conversation to summarize:

${conversationText}`
}

export function buildContextCollapseSummaryPrompt(conversationText: string): string {
  return `You are creating a local context-collapse summary for an AI coding session.
The summary will replace only this older message span in the model-visible context.
The original transcript remains preserved outside the model-visible projection.

Produce the final summary in <summary> tags.

Preserve:
- User intent and active goals
- Completed tasks and current state
- Important decisions and constraints
- Tool calls and tool results that still matter
- File reads/writes and code changes, with paths, function names, config names, and commands
- Errors, failures, warnings, and exact messages when relevant
- TODOs, uncertainty, follow-up constraints, and anything still relevant later

Rules:
- Do not invent facts or outcomes
- Do not omit critical paths, function names, configuration keys, file paths, or error text
- Keep it concise, but prefer specificity over vague compression
- This is not a full conversation compact; summarize only the provided span

Messages to summarize:

${conversationText}`
}

export function parseSummaryFromResponse(response: string): string | null {
  const summaryMatch = response.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim()
  }

  const analysisMatch = response.match(/<analysis>([\s\S]*?)<\/analysis>/)
  if (!analysisMatch) {
    const trimmed = response.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}
