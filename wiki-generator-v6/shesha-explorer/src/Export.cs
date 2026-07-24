namespace SheshaExplorer;

using System.Text.Json;
using System.Text.Json.Serialization;

public static class Exporter
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented        = true,
        Converters           = { new JsonStringEnumConverter() },
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // ── Composite risk score ──────────────────────────────────────────────
    // Raw data only — interpretation is left to the agent and the HTML explorer.
    //
    // Formula: coupling × (1 + 0.3 × smellCount) × hotspotMultiplier
    //   hotspotMultiplier = 1.5 if couplingScore >= 3.0, else 1.0
    //   isDead penalty   = -0.5 (dead nodes are lower priority to explain)
    //
    // Scale: 0.0 – ~12.0 in practice. Agent threshold for "expanded docs": >= 4.0
    // This is intentionally simple — a single sortable number per node.

    public static double CompositeRiskScore(
        string nodeId,
        Dictionary<string, double> couplingScores,
        List<Reflector.SmellReport> smells,
        HashSet<string> deadIds)
    {
        couplingScores.TryGetValue(nodeId, out var coupling);
        var smellCount    = smells.FirstOrDefault(s => s.NodeId == nodeId)?.Smells.Count ?? 0;
        var isHotspot     = coupling >= 3.0;
        var isDead        = deadIds.Contains(nodeId);
        var hotspotMult   = isHotspot ? 1.5 : 1.0;
        var deadPenalty   = isDead ? -0.5 : 0.0;
        var score         = coupling * (1.0 + 0.3 * smellCount) * hotspotMult + deadPenalty;
        return Math.Round(Math.Max(0.0, score), 2);
    }

    public static string ToJson(
        Graph graph,
        Dictionary<string, double> couplingScores,
        List<Node> deadNodes,
        List<Reflector.SmellReport> smells)
    {
        var deadIds = deadNodes.Select(n => n.Id).ToHashSet();

        var output = new ExportRoot
        {
            Nodes = graph.AllNodes
                .OrderBy(n => n.Type)
                .ThenBy(n => n.Namespace)
                .ThenBy(n => n.Name)
                .Select(n =>
                {
                    couplingScores.TryGetValue(n.Id, out var coupling);
                    var smellCount  = smells.FirstOrDefault(s => s.NodeId == n.Id)?.Smells.Count ?? 0;
                    var riskScore   = CompositeRiskScore(n.Id, couplingScores, smells, deadIds);
                    return new ExportNode
                    {
                        Id            = n.Id,
                        Name          = n.Name,
                        Type          = n.Type.ToString(),
                        Namespace     = n.Namespace,
                        Signature     = n.Signature,
                        EndGoal       = n.EndGoal,
                        CouplingScore = Math.Round(coupling, 2),
                        SmellCount    = smellCount,
                        RiskScore     = riskScore,
                        IsHotspot     = coupling >= 3.0
                    };
                }).ToList(),

            Edges = graph.AllEdges
                .Select(e => new ExportEdge
                {
                    From = e.From,
                    To   = e.To,
                    Rel  = e.Rel.ToString(),
                    Note = e.Note
                }).ToList(),

            DeadCandidates = deadNodes
                .OrderBy(n => n.Type)
                .ThenBy(n => n.Name)
                .Select(n => new ExportDeadNode
                {
                    Id        = n.Id,
                    Name      = n.Name,
                    Type      = n.Type.ToString(),
                    Namespace = n.Namespace,
                    Signature = n.Signature
                }).ToList(),

            Smells = smells
                .Select(s => new ExportSmell
                {
                    NodeId = s.NodeId,
                    Issues = s.Smells
                }).ToList(),

            Summary = new ExportSummary
            {
                TotalNodes          = graph.AllNodes.Count,
                TotalEdges          = graph.AllEdges.Count,
                Hotspots            = couplingScores.Count(s => s.Value >= 3.0),
                DeadCandidates      = deadNodes.Count,
                SmellCount          = smells.Sum(s => s.Smells.Count),
                // Mean risk score across all nodes — agent uses this as baseline:
                // nodes well above MeanRiskScore get expanded documentation
                MeanRiskScore       = graph.AllNodes.Count == 0 ? 0.0 :
                                      Math.Round(graph.AllNodes
                                          .Select(n => CompositeRiskScore(
                                              n.Id, couplingScores, smells, deadIds))
                                          .Average(), 2),
                MaxRiskScore        = graph.AllNodes.Count == 0 ? 0.0 :
                                      Math.Round(graph.AllNodes
                                          .Select(n => CompositeRiskScore(
                                              n.Id, couplingScores, smells, deadIds))
                                          .Max(), 2),
                ByType              = Enum.GetValues<NodeType>()
                                         .ToDictionary(
                                             t => t.ToString(),
                                             t => graph.AllNodes.Count(n => n.Type == t))
            }
        };

        return JsonSerializer.Serialize(output, JsonOpts);
    }

    // ── DTOs ──────────────────────────────────────────────────────────────

    private class ExportRoot
    {
        public ExportSummary        Summary        { get; set; } = new();
        public List<ExportNode>     Nodes          { get; set; } = new();
        public List<ExportEdge>     Edges          { get; set; } = new();
        public List<ExportDeadNode> DeadCandidates { get; set; } = new();
        public List<ExportSmell>    Smells         { get; set; } = new();
    }

    private class ExportNode
    {
        public string  Id            { get; set; } = "";
        public string  Name          { get; set; } = "";
        public string  Type          { get; set; } = "";
        public string  Namespace     { get; set; } = "";
        public string  Signature     { get; set; } = "";
        public string? EndGoal       { get; set; }
        public double  CouplingScore { get; set; }
        public int     SmellCount    { get; set; }
        public double  RiskScore     { get; set; }
        public bool    IsHotspot     { get; set; }
    }

    private class ExportEdge
    {
        public string From { get; set; } = "";
        public string To   { get; set; } = "";
        public string Rel  { get; set; } = "";
        public string Note { get; set; } = "";
    }

    private class ExportDeadNode
    {
        public string Id        { get; set; } = "";
        public string Name      { get; set; } = "";
        public string Type      { get; set; } = "";
        public string Namespace { get; set; } = "";
        public string Signature { get; set; } = "";
    }

    private class ExportSmell
    {
        public string       NodeId { get; set; } = "";
        public List<string> Issues { get; set; } = new();
    }

    private class ExportSummary
    {
        public int                     TotalNodes     { get; set; }
        public int                     TotalEdges     { get; set; }
        public int                     Hotspots       { get; set; }
        public int                     DeadCandidates { get; set; }
        public int                     SmellCount     { get; set; }
        public double                  MeanRiskScore  { get; set; }
        public double                  MaxRiskScore   { get; set; }
        public Dictionary<string, int> ByType         { get; set; } = new();
    }
}
