using SheshaExplorer;

// ── Parse args ────────────────────────────────────────────────────────────────

string? dllPath    = null;
string? nsPrefix   = null;
string? outputFile = null;

// BUG 5 FIX: bounds-checked argument parsing
for (int i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--dll-path":
            if (i + 1 >= args.Length) { ArgError("--dll-path"); return 1; }
            dllPath = args[++i];
            break;
        case "--namespace":
            if (i + 1 >= args.Length) { ArgError("--namespace"); return 1; }
            nsPrefix = args[++i];
            break;
        case "--output":
            if (i + 1 >= args.Length) { ArgError("--output"); return 1; }
            outputFile = args[++i];
            break;
        case "--help":
            PrintHelp();
            return 0;
        default:
            Console.Error.WriteLine($"Unknown argument: {args[i]}");
            Console.Error.WriteLine("Run with --help for usage.");
            return 1;
    }
}

if (dllPath == null)
{
    Console.Error.WriteLine("ERROR: --dll-path is required.");
    Console.Error.WriteLine(
        "Usage: dotnet run --project src -- " +
        "--dll-path ./bin/Release/net8.0/ [--namespace MyCompany] [--output graph.json]");
    return 1;
}

if (!Directory.Exists(dllPath))
{
    Console.Error.WriteLine($"ERROR: DLL path does not exist: {dllPath}");
    Console.Error.WriteLine("Did you run 'dotnet build --configuration Release' first?");
    return 1;
}

var dlls = Directory.GetFiles(dllPath, "*.dll", SearchOption.TopDirectoryOnly);
if (dlls.Length == 0)
{
    Console.Error.WriteLine($"ERROR: No .dll files found in {dllPath}");
    Console.Error.WriteLine("Suggestions:");
    Console.Error.WriteLine("  1. Run 'dotnet build --configuration Release' and retry");
    Console.Error.WriteLine(
        "  2. Use Option 4 in /wiki-generator to read source files directly instead");
    return 1;
}

// ── Path boundary check ───────────────────────────────────────────────────────

var resolvedDllPath = Path.GetFullPath(dllPath);
var resolvedWorkDir = Path.GetFullPath(Directory.GetCurrentDirectory());

if (!resolvedDllPath.StartsWith(resolvedWorkDir, StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine(
        $"WARNING: DLL path '{resolvedDllPath}' is outside " +
        $"the current directory '{resolvedWorkDir}'.");
    Console.Error.WriteLine(
        "This may reflect system or third-party assemblies unrelated to your project.");
    // FIX 4: Console.ReadLine() blocks forever when stdin is piped/redirected
    // (e.g. `echo y | dotnet run`). Auto-confirm in non-interactive mode.
    if (Console.IsInputRedirected)
    {
        Console.Error.WriteLine("Non-interactive mode — auto-confirming path boundary warning.");
    }
    else
    {
        Console.Error.Write("Continue anyway? (y/N): ");
        var confirm = Console.ReadLine()?.Trim().ToLowerInvariant();
        if (confirm != "y" && confirm != "yes")
        {
            Console.Error.WriteLine("Aborted.");
            return 1;
        }
    }
}

// ── Reflect ───────────────────────────────────────────────────────────────────

Console.Error.WriteLine($"SheshaExplorer v1.0");
Console.Error.WriteLine($"Reflecting assemblies in: {resolvedDllPath}");
if (nsPrefix != null)
    Console.Error.WriteLine($"Namespace filter: {nsPrefix}");
else
    Console.Error.WriteLine(
        "TIP: Add --namespace YourCompany to filter to your project's types only.");

// FIX 14: surface any unexpected reflection failure as a clean error
// instead of an unhandled-exception stack trace.
(Graph graph, List<Reflector.SmellReport> smells) reflectResult;
try
{
    reflectResult = Reflector.Reflect(resolvedDllPath, nsPrefix);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"ERROR: Reflection failed unexpectedly: {ex.Message}");
    Console.Error.WriteLine("The DLL folder may contain incompatible assemblies.");
    Console.Error.WriteLine("Try adding --namespace YourCompany to filter to your types only.");
    return 1;
}
var (graph, smells) = reflectResult;

Console.Error.WriteLine(
    $"Discovered {graph.AllNodes.Count} nodes, {graph.AllEdges.Count} edges");

if (graph.AllNodes.Count == 0)
{
    Console.Error.WriteLine("WARNING: No Shesha nodes found.");
    Console.Error.WriteLine(
        "Try: --namespace YourCompany.YourProject");
    Console.Error.WriteLine(
        "Or:  Use Option 4 in /wiki-generator to read source .cs files directly.");
    // Don't exit — still produce empty JSON so the skill can explain the gap
}

// ── Run CA ────────────────────────────────────────────────────────────────────

Console.Error.WriteLine("Running cellular automaton propagation...");
var scores    = Automaton.CouplingScores(graph);
var reachable = Automaton.AllReachable(graph);
var dead      = Automaton.DeadNodes(graph, reachable);

var hotspotCount = scores.Count(s => s.Value >= 3.0);
Console.Error.WriteLine($"  Hotspots (coupling >= 3.0) : {hotspotCount}");
Console.Error.WriteLine($"  Dead code candidates       : {dead.Count}");
Console.Error.WriteLine($"  Code smells                : {smells.Sum(s => s.Smells.Count)}");

// ── Export ────────────────────────────────────────────────────────────────────

var json = Exporter.ToJson(graph, scores, dead, smells);

if (outputFile != null)
{
    // Ensure output directory exists
    var outDir = Path.GetDirectoryName(outputFile);
    if (!string.IsNullOrEmpty(outDir))
        Directory.CreateDirectory(outDir);

    File.WriteAllText(outputFile, json);
    Console.Error.WriteLine($"Graph written to: {Path.GetFullPath(outputFile)}");
    Console.Error.WriteLine("Ready for /wiki-generator Option 4 or explorer.html");
}
else
{
    Console.WriteLine(json);
}

Console.Error.WriteLine("Done.");
return 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

static void ArgError(string flag)
{
    Console.Error.WriteLine($"ERROR: {flag} requires a value.");
    Console.Error.WriteLine("Run with --help for usage.");
}

static void PrintHelp()
{
    Console.WriteLine("""
    SheshaExplorer — reflects Shesha .NET assemblies into a relationship graph

    Usage:
      dotnet run --project src -- --dll-path <path> [options]

    Options:
      --dll-path   <path>   Path to folder containing compiled .dll files (required)
      --namespace  <prefix> Only reflect types in this namespace prefix (recommended)
      --output     <file>   Write JSON to file instead of stdout
      --help                Show this help

    Examples:
      dotnet run --project src -- --dll-path ./bin/Release/net8.0/
      dotnet run --project src -- --dll-path ./bin/Release/net8.0/ --namespace Boxfusion
      dotnet run --project src -- --dll-path ./bin/Release/net8.0/ --namespace Boxfusion --output graph.json

    Output:
      JSON is written to --output file, or stdout if omitted.
      Open explorer.html in a browser and load the JSON to explore visually.
      Or pass the JSON to /wiki-generator Option 4 to generate a wiki page.
    """);
}
