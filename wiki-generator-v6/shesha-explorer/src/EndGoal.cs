namespace SheshaExplorer;

public static class EndGoalInferrer
{
    private record Rule(string Verb, string Pattern, string Goal);

    private static readonly List<Rule> Rules = new()
    {
        new("POST",   "complete",      "Complete lifecycle step"),
        new("POST",   "approve",       "Approval workflow"),
        new("POST",   "reject",        "Rejection workflow"),
        new("POST",   "submit",        "Submit for processing"),
        new("POST",   "cancel",        "Cancellation workflow"),
        new("POST",   "archive",       "Archive / close record"),
        new("POST",   "publish",       "Publish / make active"),
        new("POST",   "activate",      "Activate entity"),
        new("POST",   "deactivate",    "Deactivate entity"),
        new("POST",   "assign",        "Assignment workflow"),
        new("POST",   "unassign",      "Unassignment workflow"),
        new("POST",   "escalate",      "Escalation workflow"),
        new("POST",   "resolve",       "Resolution workflow"),
        new("POST",   "close",         "Close record"),
        new("POST",   "reopen",        "Reopen closed record"),
        new("POST",   "confirm",       "Confirmation step"),
        new("POST",   "notify",        "Notification dispatch"),
        new("POST",   "send",          "Send / dispatch"),
        new("POST",   "process",       "Process / execute"),
        new("POST",   "generate",      "Generate artefact"),
        new("POST",   "create",        "Create new record"),
        new("POST",   "add",           "Add record"),
        new("PUT",    "update",        "Update existing record"),
        new("PATCH",  "update",        "Partial update"),
        new("DELETE", "delete",        "Delete record"),
        new("DELETE", "remove",        "Remove record"),
        new("GET",    "list",          "List / search records"),
        new("GET",    "get",           "Retrieve single record"),
        new("GET",    "search",        "Search records"),
        new("GET",    "export",        "Export data"),
        new("GET",    "report",        "Generate report"),
        new("GET",    "summary",       "Retrieve summary"),
        new("POST",   "login",         "User authentication"),
        new("POST",   "logout",        "User session termination"),
        new("POST",   "register",      "User registration"),
        new("POST",   "resetpassword", "Password reset workflow"),
        new("POST",   "changepassword","Password change"),
        new("POST",   "",              "State-mutating operation"),
        new("GET",    "",              "Data retrieval"),
    };

    public static string? Infer(string name, string verb)
    {
        var lower = name.ToLowerInvariant();
        foreach (var rule in Rules)
        {
            bool verbMatch = rule.Verb == "*" || rule.Verb == verb;
            bool nameMatch = string.IsNullOrEmpty(rule.Pattern) || lower.Contains(rule.Pattern);
            if (verbMatch && nameMatch) return rule.Goal;
        }
        return null;
    }
}
