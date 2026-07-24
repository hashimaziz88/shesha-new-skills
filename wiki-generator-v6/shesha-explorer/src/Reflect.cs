namespace SheshaExplorer;

using System.Reflection;

public static class Reflector
{
    private static readonly string[] SystemPrefixes =
        ["System.", "Microsoft.", "mscorlib", "netstandard", "Newtonsoft.",
         "AutoMapper.", "FluentValidation.", "Hangfire.", "log4net.",
         "Castle.", "Abp.", "NHibernate."];

    private static readonly string[] GenericNames =
        ["get", "set", "do", "run", "handle", "process", "execute",
         "perform", "update", "manage", "check", "validate", "init",
         "start", "stop", "load", "save", "create", "delete"];

    public record SmellReport(string NodeId, List<string> Smells);

    public static (Graph graph, List<SmellReport> smells) Reflect(
        string dllFolder, string? namespacePrefix)
    {
        // FIX 1: suppress transitive dependency resolution failures.
        // Framework-dependent publish folders omit shared-framework assemblies
        // (ASP.NET Core, etc.). Returning null here lets reflection proceed
        // with partial metadata instead of throwing during type access.
        AppDomain.CurrentDomain.AssemblyResolve += (_, _) => null;

        var graph       = new Graph();
        var smells      = new List<SmellReport>();
        var dlls        = Directory.GetFiles(dllFolder, "*.dll",
                            SearchOption.TopDirectoryOnly);
        var failedDlls  = new List<string>();   // BUG 8 FIX: collect failures
        var allTypes    = new List<Type>();

        // ── Pass 1: load all types ────────────────────────────────────────
        foreach (var dll in dlls)
        {
            var fileName = Path.GetFileName(dll);
            if (IsSystemDll(fileName)) continue;

            Assembly asm;
            try
            {
                asm = Assembly.LoadFrom(dll);
            }
            catch (Exception ex)
            {
                // BUG 8 FIX: record but don't silently continue
                failedDlls.Add($"{fileName}: {ex.Message}");
                continue;
            }

            Type[] types;
            try
            {
                types = asm.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                // BUG 3 FIX: explicit cast to Type[] after null filter
                types = ex.Types
                    .Where(t => t is not null)
                    .Select(t => t!)
                    .ToArray();
            }

            // FIX 2: accessing t.Namespace can throw on types whose declaring
            // assembly had transitive load failures — guard per type.
            allTypes.AddRange(types.Where(t =>
            {
                try
                {
                    return t.Namespace != null &&
                           (namespacePrefix == null ||
                            t.Namespace.StartsWith(namespacePrefix,
                                StringComparison.OrdinalIgnoreCase));
                }
                catch { return false; }
            }));
        }

        // ── BUG 8 FIX: report failures for namespace-matching DLLs ───────
        if (failedDlls.Count > 0)
        {
            Console.Error.WriteLine($"[WARN] {failedDlls.Count} DLL(s) could not be loaded:");
            foreach (var f in failedDlls)
                Console.Error.WriteLine($"  - {f}");
            Console.Error.WriteLine("These assemblies will not appear in the graph.");
            Console.Error.WriteLine("If a key assembly failed, consider Option 4 (read source files directly).");
        }

        // ── Pass 2: classify and add nodes ───────────────────────────────
        // FIX 3: a single type with missing transitive dependencies must not
        // abort the whole run — skip it and keep going.
        foreach (var type in allTypes)
        {
            try { ProcessType(type, graph, smells); }
            catch { /* skip types that fail due to missing transitive dependencies */ }
        }

        // ── Pass 3: add name-matching edges (BUG 7 FIX) ──────────────────
        AddNameMatchingEdges(graph);

        return (graph, smells);
    }

    // BUG 7 FIX: infer edges between AppService methods and entities
    // by matching name segments (e.g. ProgressReportsAppService ↔ ProgressReport)
    private static void AddNameMatchingEdges(Graph graph)
    {
        var services  = graph.AllNodes
            .Where(n => n.Type == NodeType.AppServiceMethod)
            .ToList();
        var entities  = graph.AllNodes
            .Where(n => n.Type == NodeType.DomainEntity)
            .ToList();

        foreach (var svc in services)
        {
            // Extract the entity name hint from the service class name
            // e.g. "ProgressReportsAppService.PublishProgressReportAsync"
            // → parent class segment before AppService
            var classSegment = svc.FullName
                .Split('.')
                .SkipLast(1)   // remove method name
                .LastOrDefault() ?? "";
            var entityHint = classSegment
                .Replace("AppService", "")
                .TrimEnd('s'); // naive depluralize

            if (entityHint.Length < 4) continue; // too short to be meaningful

            foreach (var entity in entities)
            {
                // Match if entity name contains the hint or vice versa
                if (entity.Name.Contains(entityHint,
                        StringComparison.OrdinalIgnoreCase) ||
                    entityHint.Contains(entity.Name,
                        StringComparison.OrdinalIgnoreCase))
                {
                    // FIX 5: only add if this (from, to, rel) edge doesn't
                    // already exist — prevents duplicate edges inflating counts
                    if (!graph.EdgeExists(svc.Id, entity.Id, RelType.SharedType))
                        graph.AddEdge(new Edge(
                            svc.Id, entity.Id,
                            RelType.SharedType,
                            $"name-match: {entityHint} ~ {entity.Name}"));
                }
            }
        }
    }

    private static void ProcessType(
        Type type, Graph graph, List<SmellReport> smells)
    {
        var nodeType = ClassifyType(type);
        if (nodeType == null) return;

        if (nodeType == NodeType.AppServiceMethod)
        {
            // BUG 2 FIX: skip abstract types to avoid duplicate nodes
            // from both interface and concrete class
            if (type.IsAbstract && !type.IsInterface) return;

            foreach (var method in type.GetMethods(
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                // Skip property accessors and object methods
                if (method.IsSpecialName) continue;
                if (method.DeclaringType == typeof(object)) continue;

                var id      = $"{type.FullName}.{method.Name}";
                var sig     = BuildSignature(method);
                var verb    = ExtractVerb(method);
                var endGoal = EndGoalInferrer.Infer(method.Name, verb);
                var perm    = ExtractPermission(method);

                // Skip if already added (e.g. from interface + concrete)
                if (graph.GetNode(id) != null) continue;

                var node = new Node(id, NodeType.AppServiceMethod,
                    method.Name, id, type.Namespace ?? "", sig, endGoal);
                graph.AddNode(node);

                if (perm != null)
                {
                    var permId = $"perm:{perm}";
                    if (graph.GetNode(permId) == null)
                        graph.AddNode(new Node(permId, NodeType.PermissionCheck,
                            perm, permId, type.Namespace ?? "", perm, null));
                    graph.AddEdge(new Edge(id, permId,
                        RelType.AuthorisedBy, $"[ShaAuthorize(\"{perm}\")]"));
                }

                var nodeSmells = DetectSmells(method.Name, verb,
                    method.GetParameters().Length);
                if (nodeSmells.Count > 0)
                    smells.Add(new SmellReport(id, nodeSmells));
            }
        }
        else
        {
            var id  = type.FullName ?? type.Name;
            if (graph.GetNode(id) != null) return; // dedup

            var sig = BuildTypeSummary(type, nodeType.Value);

            string? endGoal = null;
            if (nodeType == NodeType.ApiEndpoint)
            {
                var verb = ExtractVerbFromType(type);
                endGoal  = EndGoalInferrer.Infer(type.Name, verb);
            }

            var node = new Node(id, nodeType.Value,
                type.Name, id, type.Namespace ?? "", sig, endGoal);
            graph.AddNode(node);
        }
    }

    private static NodeType? ClassifyType(Type t)
    {
        // Skip compiler-generated, nested private, and generic type definitions
        if (t.IsNested && t.IsNestedPrivate) return null;
        if (t.Name.StartsWith('<'))          return null;
        // FIX 12: also catch <>c__DisplayClass / <>c closure patterns that may
        // not begin with '<' on some compiler versions.
        if (t.Name.Contains('>'))            return null;
        if (t.IsGenericTypeDefinition && t.GetGenericArguments().Length > 1)
            return null;

        var name   = t.Name;
        var bases  = GetBaseTypeNames(t);

        // FIX 7: GetInterfaces() can throw when an interface lives in a missing
        // assembly — fall back to an empty set.
        HashSet<string> ifaces;
        try { ifaces = t.GetInterfaces().Select(i => i.Name).ToHashSet(); }
        catch { ifaces = new HashSet<string>(); }

        // FIX 8: GetCustomAttributesData() can throw when the attribute's
        // assembly is missing — resolve the [Entity] check defensively.
        bool hasEntityAttr;
        try
        {
            hasEntityAttr = t.GetCustomAttributesData()
                .Any(a => a.AttributeType.Name == "EntityAttribute");
        }
        catch { hasEntityAttr = false; }

        if (bases.Contains("ApplicationService") ||
            ifaces.Contains("IApplicationService") ||
            name.EndsWith("AppService"))
            return NodeType.AppServiceMethod;

        if (bases.Contains("Entity") ||
            bases.Any(b => b.StartsWith("Entity`")) ||
            bases.Contains("FullAuditedEntity") ||
            bases.Contains("CreationAuditedEntity") ||
            bases.Contains("AuditedEntity") ||
            hasEntityAttr)
            return NodeType.DomainEntity;

        if (name.StartsWith("IRepository") ||
            name.EndsWith("Repository") ||
            ifaces.Any(i => i.StartsWith("IRepository")))
            return NodeType.Repository;

        if (name.EndsWith("Controller") ||
            bases.Contains("AbpController") ||
            bases.Contains("ControllerBase"))
            return NodeType.ApiEndpoint;

        if (name.EndsWith("PermissionNames") ||
            name.EndsWith("Permissions"))
            return NodeType.PermissionCheck;

        return null;
    }

    private static List<string> GetBaseTypeNames(Type t)
    {
        var names = new List<string>();
        // FIX 6: b.BaseType can throw TypeLoadException when a base type's
        // assembly is missing — return what we have collected so far.
        try
        {
            var b = t.BaseType;
            while (b != null && b != typeof(object))
            {
                names.Add(b.Name);
                b = b.BaseType;
            }
        }
        catch { /* incomplete base chain — return what we have */ }
        return names;
    }

    private static string BuildSignature(MethodInfo m)
    {
        // FIX 11: p.ParameterType.Name throws if the parameter type's assembly
        // is missing — degrade to "?" for that parameter.
        var parms = m.GetParameters().Select(p =>
        {
            try { return $"{p.ParameterType.Name} {p.Name}"; }
            catch { return $"? {p.Name}"; }
        });
        return $"{m.ReturnType.Name} {m.Name}({string.Join(", ", parms)})";
    }

    private static string BuildTypeSummary(Type t, NodeType nt) => nt switch
    {
        // FIX 10: GetProperties()/PropertyType.Name can throw on partial types
        // with navigation properties in missing assemblies — fall back to name.
        NodeType.DomainEntity => BuildEntitySummary(t),
        _ => t.Name
    };

    private static string BuildEntitySummary(Type t)
    {
        try
        {
            return string.Join(", ", t.GetProperties(
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Take(8)
                .Select(p => $"{p.PropertyType.Name} {p.Name}"));
        }
        catch { return t.Name; }
    }

    private static string ExtractVerb(MethodInfo m)
    {
        // FIX 9: GetCustomAttributesData() can throw when an attribute's
        // assembly is missing — treat as no verb attributes.
        IEnumerable<string> attrs;
        try { attrs = m.GetCustomAttributesData().Select(a => a.AttributeType.Name).ToList(); }
        catch { return "*"; }
        if (attrs.Contains("HttpPostAttribute"))   return "POST";
        if (attrs.Contains("HttpGetAttribute"))    return "GET";
        if (attrs.Contains("HttpPutAttribute"))    return "PUT";
        if (attrs.Contains("HttpDeleteAttribute")) return "DELETE";
        if (attrs.Contains("HttpPatchAttribute"))  return "PATCH";
        return "*";
    }

    private static string ExtractVerbFromType(Type t)
    {
        // FIX 9: guard GetCustomAttributesData() against missing-assembly throws.
        IEnumerable<string> attrs;
        try { attrs = t.GetCustomAttributesData().Select(a => a.AttributeType.Name).ToList(); }
        catch { return "*"; }
        if (attrs.Contains("HttpPostAttribute"))   return "POST";
        if (attrs.Contains("HttpGetAttribute"))    return "GET";
        return "*";
    }

    private static string? ExtractPermission(MethodInfo m)
    {
        // FIX 9: guard GetCustomAttributesData() against missing-assembly throws.
        CustomAttributeData? shaAuth;
        try
        {
            shaAuth = m.GetCustomAttributesData()
                .FirstOrDefault(a =>
                    a.AttributeType.Name == "ShaAuthorizeAttribute" ||
                    a.AttributeType.Name == "AuthorizeAttribute");
        }
        catch { return null; }
        if (shaAuth == null) return null;
        var arg = shaAuth.ConstructorArguments.FirstOrDefault();
        return arg.Value?.ToString();
    }

    private static List<string> DetectSmells(
        string name, string verb, int paramCount)
    {
        var result = new List<string>();
        var lower  = name.ToLowerInvariant();

        if (GenericNames.Contains(lower))
            result.Add($"Generic name '{name}' — too vague to reveal intent");

        if (verb == "GET" &&
            new[] {"update","delete","remove","complete","process","set"}
                .Any(lower.Contains))
            result.Add(
                $"CQS violation: GET endpoint '{name}' has a mutating name");

        if (verb == "POST" &&
            new[] {"get","list","search","find","fetch"}.Any(lower.Contains))
            result.Add(
                $"CQS violation: POST endpoint '{name}' looks like a query");

        if (paramCount > 5)
            result.Add(
                $"Too many parameters ({paramCount}) — consider an input DTO");

        return result;
    }

    private static bool IsSystemDll(string fileName) =>
        SystemPrefixes.Any(p =>
            fileName.StartsWith(p, StringComparison.OrdinalIgnoreCase));
}
