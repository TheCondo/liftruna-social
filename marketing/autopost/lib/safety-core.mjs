// The safety check itself (D86), shared by the draft maker (Node) and the
// Cloudflare Worker, which both pass in the rules from data/safety.json.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeChecks(rules) {
  // Whole words or phrases, any case.
  const wordRes = rules.words.map((w) => ({ w, re: new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}($|[^a-z0-9])`, "i") }));
  const patternRes = rules.patterns.map((p) => ({ p, re: new RegExp(p, "i") }));
  const topicRes = rules.blockedTopics.map((w) => new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}`, "i"));

  const blockedTopic = (text) => topicRes.some((re) => re.test(text));

  // Returns a list of problems; empty means the text passed.
  // (Posts no longer have to say 18+: Connor, 24 Nov 2026; the terms say it.)
  function check(text) {
    const problems = [];
    for (const { w, re } of wordRes) if (re.test(text)) problems.push(`uses "${w}"`);
    for (const { p, re } of patternRes) if (re.test(text)) problems.push(`matches ${p}`);
    return problems;
  }

  return { check, blockedTopic };
}
