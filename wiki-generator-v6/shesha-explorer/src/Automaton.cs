namespace SheshaExplorer;

public static class Automaton
{
    public record CAResult(
        Dictionary<string, int> ActivationGen,
        int TotalGenerations
    );

    /// <summary>
    /// Seeds CA from a single node and propagates until fixpoint.
    /// </summary>
    public static CAResult RunFrom(Graph graph, string seedId)
    {
        var activated = new Dictionary<string, int> { [seedId] = 0 };
        var frontier  = new HashSet<string> { seedId };
        int gen       = 0;

        while (frontier.Count > 0)
        {
            gen++;
            var next = new HashSet<string>();

            foreach (var id in frontier)
            {
                foreach (var neighbour in graph.Neighbours(id))
                {
                    if (!activated.ContainsKey(neighbour))
                    {
                        activated[neighbour] = gen;
                        next.Add(neighbour);
                    }
                }
            }

            frontier = next;
        }

        return new CAResult(activated, gen);
    }

    /// <summary>
    /// BUG 4 FIX: only seed from AppService + ApiEndpoint nodes.
    /// Seeding from every node (including DTOs, permissions) was O(n²)
    /// on large graphs and produced misleading coupling scores for
    /// leaf nodes that are not meaningful entry points.
    /// Coupling score = mean activation generation from all entry points.
    /// Higher score = more indirect paths reach this node = higher coupling.
    /// </summary>
    public static Dictionary<string, double> CouplingScores(Graph graph)
    {
        var genLists = new Dictionary<string, List<int>>();

        // Only seed from meaningful entry points
        var seeds = graph.AllNodes
            .Where(n => n.Type is NodeType.ApiEndpoint
                              or NodeType.AppServiceMethod)
            .Select(n => n.Id)
            .ToList();

        if (seeds.Count == 0)
        {
            // Fallback: seed from everything if no entry points found
            seeds = graph.AllNodes.Select(n => n.Id).ToList();
        }

        foreach (var seed in seeds)
        {
            var result = RunFrom(graph, seed);
            foreach (var (id, gen) in result.ActivationGen)
            {
                if (!genLists.ContainsKey(id)) genLists[id] = new();
                genLists[id].Add(gen);
            }
        }

        return genLists.ToDictionary(
            kv => kv.Key,
            kv => kv.Value.Average()
        );
    }

    /// <summary>
    /// Nodes never activated from any entry point = dead code candidates.
    /// </summary>
    public static List<Node> DeadNodes(
        Graph graph, IEnumerable<string> everActive)
    {
        var activeSet = everActive.ToHashSet();
        return graph.AllNodes
            .Where(n => !activeSet.Contains(n.Id))
            .ToList();
    }

    /// <summary>
    /// Union of everything reachable from all AppService + ApiEndpoint seeds.
    /// </summary>
    public static HashSet<string> AllReachable(Graph graph)
    {
        var reached = new HashSet<string>();
        var seeds   = graph.AllNodes
            .Where(n => n.Type is NodeType.ApiEndpoint
                              or NodeType.AppServiceMethod)
            .Select(n => n.Id);

        foreach (var seed in seeds)
        {
            var result = RunFrom(graph, seed);
            foreach (var id in result.ActivationGen.Keys)
                reached.Add(id);
        }

        return reached;
    }
}
