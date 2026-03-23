export async function buildGoalChainContext(db: any, goalId: string): Promise<string> {
  const chain: any[] = [];
  let currentId: string | null = goalId;
  const maxDepth = 10;
  let depth = 0;

  while (currentId && depth < maxDepth) {
    const currentGoal: any = await db.goal.findUnique({ where: { id: currentId } });
    if (!currentGoal) break;
    chain.push(currentGoal);
    currentId = currentGoal.parentId || null;
    depth++;
  }
  
  if (chain.length === 0) return "";

  // Reverse so top-level goal is first
  chain.reverse();
  
  let contextStr = "[CONTEXT: GOALS HIERARCHY]\n";
  for (let i = 0; i < chain.length; i++) {
    const g = chain[i];
    const indent = "  ".repeat(i);
    contextStr += `${indent}- [${g.level.toUpperCase()}] ${g.title}\n`;
    if (g.description) {
      contextStr += `${indent}  ${g.description}\n`;
    }
  }
  return contextStr + "\n";
}
