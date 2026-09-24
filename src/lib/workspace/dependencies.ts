export interface DependencyEdge {
  predecessorId: string;
  successorId: string;
  type: "blocks" | "waiting_on" | "parent_child" | "related";
}

export function validateDependency(
  existing: DependencyEdge[],
  candidate: DependencyEdge,
) {
  if (candidate.predecessorId === candidate.successorId) {
    return { valid: false, reason: "self_dependency" as const };
  }
  if (candidate.type === "related") return { valid: true, reason: null };

  const adjacency = new Map<string, string[]>();
  for (const edge of [...existing, candidate]) {
    if (edge.type === "related") continue;
    const successors = adjacency.get(edge.predecessorId) ?? [];
    successors.push(edge.successorId);
    adjacency.set(edge.predecessorId, successors);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  function hasCycle(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    const cycle = (adjacency.get(node) ?? []).some(hasCycle);
    stack.delete(node);
    return cycle;
  }

  const cycle = [...adjacency.keys()].some(hasCycle);
  return {
    valid: !cycle,
    reason: cycle ? ("dependency_cycle" as const) : null,
  };
}
