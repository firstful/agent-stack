import type { Conversation, BudgetStrategy } from "../types.js"

export interface BudgetContextResult {
  strategy: BudgetStrategy
  applied: boolean
  message: string
}

export function executeBudgetContext(
  conv: Conversation,
  strategy: BudgetStrategy,
): BudgetContextResult {
  const validStrategies: BudgetStrategy[] = ["expand_recent", "preserve_old", "balanced", "task_focus"]

  if (!validStrategies.includes(strategy)) {
    return {
      strategy,
      applied: false,
      message: `Invalid strategy: ${strategy}. Must be one of: ${validStrategies.join(", ")}`,
    }
  }

  conv.metadata = { ...conv.metadata, budgetStrategy: strategy }
  conv.updatedAt = Date.now()

  const descMap: Record<BudgetStrategy, string> = {
    expand_recent: "Prioritizes recent context, allocating more tokens to recent turns",
    preserve_old: "Preserves older context at the expense of recent compression",
    balanced: "Equal allocation across the full conversation history",
    task_focus: "Optimizes for task-relevant context based on memory importance scores",
  }

  return {
    strategy,
    applied: true,
    message: `Budget strategy set to '${strategy}': ${descMap[strategy]}`,
  }
}
