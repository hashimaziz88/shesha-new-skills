namespace SheshaExplorer;

public enum NodeType
{
    AppServiceMethod,
    DomainEntity,
    Repository,
    ApiEndpoint,
    PermissionCheck
}

public enum RelType
{
    Calls,
    CalledBy,
    SharedType,
    SameNamespace,
    LifecycleStep,
    AuthorisedBy
}

public record Node(
    string Id,
    NodeType Type,
    string Name,
    string FullName,
    string Namespace,
    string Signature,
    string? EndGoal
);

public record Edge(
    string From,
    string To,
    RelType Rel,
    string Note
);

public class Graph
{
    private readonly Dictionary<string, Node> _nodes = new();
    private readonly List<Edge> _edges = new();
    private readonly Dictionary<string, HashSet<string>> _outIdx = new();
    private readonly Dictionary<string, HashSet<string>> _inIdx = new();

    public void AddNode(Node n) => _nodes[n.Id] = n;

    public void AddEdge(Edge e)
    {
        _edges.Add(e);
        if (!_outIdx.ContainsKey(e.From)) _outIdx[e.From] = new();
        if (!_inIdx.ContainsKey(e.To))   _inIdx[e.To]   = new();
        _outIdx[e.From].Add(e.To);
        _inIdx[e.To].Add(e.From);
    }

    public IReadOnlyCollection<Node> AllNodes => _nodes.Values;
    public IReadOnlyCollection<Edge> AllEdges  => _edges;
    public Node? GetNode(string id) => _nodes.GetValueOrDefault(id);

    public HashSet<string> Neighbours(string id)
    {
        var result = new HashSet<string>();
        if (_outIdx.TryGetValue(id, out var out_)) result.UnionWith(out_);
        if (_inIdx.TryGetValue(id, out var in_))   result.UnionWith(in_);
        return result;
    }

    public IEnumerable<Edge> EdgesFrom(string id) => _edges.Where(e => e.From == id);
    public IEnumerable<Edge> EdgesTo(string id)   => _edges.Where(e => e.To   == id);

    // FIX 5: duplicate-edge guard. O(n) per check, acceptable for the
    // graph sizes encountered (< 500 edges before dedup).
    public bool EdgeExists(string from, string to, RelType rel) =>
        _edges.Any(e => e.From == from && e.To == to && e.Rel == rel);
}
