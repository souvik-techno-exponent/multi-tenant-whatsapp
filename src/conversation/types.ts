export enum MatchType {
    Equals = "equals",
    Contains = "contains",
    Regex = "regex",
}

export function toMatchType(input?: string): MatchType {
    switch (input) {
        case MatchType.Contains: return MatchType.Contains;
        case MatchType.Regex: return MatchType.Regex;
        case MatchType.Equals: return MatchType.Equals;
        default: return MatchType.Equals; // safe default
    }
}

export function isMatchType(x: unknown): x is MatchType {
    return x === "equals" || x === "contains" || x === "regex";
}
