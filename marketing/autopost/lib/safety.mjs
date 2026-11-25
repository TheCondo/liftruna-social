// Safety checks every draft must pass before Connor sees it (D86).
import { readFileSync } from "node:fs";
import { makeChecks } from "./safety-core.mjs";

const rules = JSON.parse(readFileSync(new URL("../data/safety.json", import.meta.url), "utf8"));

export const { check, blockedTopic } = makeChecks(rules);
