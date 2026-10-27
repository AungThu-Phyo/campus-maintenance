import { Hono } from "hono";
import maintenanceKnowledge from "../maintenance-knowledge.json";

type DecisionCategory = "plumbing" | "electrical" | "air_conditioning" | "other";
type UrgencyLevel = "low" | "moderate" | "high" | "critical" | "unknown";

const classificationRules: Record<Exclude<DecisionCategory, "other">, RegExp[]> = {
  plumbing: [
    /\bplumb(?:ing|er)?\b/i,
    /\b(?:water|pipe|ceiling)\b.{0,40}\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?)\b/i,
    /\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?)\b.{0,40}\b(?:water|pipe|ceiling)\b/i,
    /\b(?:faucet|tap|toilet|drain|sink|sewage|water pressure|water heater)\b/i,
  ],
  electrical: [
    /\belectri(?:cal|city)\b/i,
    /\belectrical equipment\b/i,
    /\b(?:outlet|socket|breaker|fuse|wiring|wire|power outage|short circuit)\b/i,
    /\b(?:flicker(?:s|ed|ing)?)\b.{0,20}\b(?:light|lights)\b/i,
    /\b(?:light|lights)\b.{0,20}\b(?:flicker(?:s|ed|ing)?|out)\b/i,
  ],
  air_conditioning: [
    /\b(?:air conditioning|air conditioner|a\/c|ac(?: unit)?|hvac|ventilation|thermostat)\b/i,
    /\b(?:heating|cooling) system\b/i,
  ],
};

const criticalSafetyRules: RegExp[] = [
  /\bfire\b/i,
  /\bsmoke\b/i,
  /\bsparks?\b|\bsparking\b/i,
  /\bexposed\s+(?:live\s+)?(?:electrical\s+)?wires?\b/i,
  /\blive\s+wires?\b/i,
  /\b(?:electric(?:al)?\s+shock|electrocution)\b/i,
];

const safetyConcernRules: RegExp[] = [
  /\b(?:unsafe|dangerous?|hazard(?:ous)?|slippery|flood(?:ing|ed)?)\b/i,
  /\b(?:gas leak|gas smell|ceiling (?:is )?collapsing|structural damage|blocked exit|injur(?:y|ed)|emergency)\b/i,
  /\bexposed\s+(?:electrical\s+)?wiring\b/i,
  /\bwater\b.{0,40}\b(?:near|around|on|inside)\b.{0,30}\b(?:outlet|socket|wire|electrical panel|breaker)\b/i,
  /\b(?:outlet|socket|wire|electrical panel|breaker)\b.{0,40}\b(?:near|surrounded by|in)\b.{0,30}\bwater\b/i,
  /\bburning\s+(?:smell|odor|odour)\b/i,
];

const highUrgencyRules: RegExp[] = [
  /\b(?:water|pipe|ceiling)\b.{0,50}\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?)\b.{0,30}\b(?:floor|classroom|room)\b/i,
  /\b(?:large|major|rapid|uncontrolled)\s+(?:water\s+)?leak\b/i,
  /\bburst\s+pipe\b/i,
];

const criticalElectricalContext: RegExp[] = [
  /\b(?:electri(?:cal|city)|outlet|socket|breaker|fuse|wiring|wire|power|appliance|equipment|panel|light|lighting|fixture)\b/i,
];

const issueRules: RegExp[] = [
  /\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?|broken|not working|does not work|doesn't work|won't work|stopped working|faulty|damaged|loose|jammed|clogged|blocked|flicker(?:s|ed|ing)?|rattl(?:e|ing)|not cooling|no cool air|overheat(?:ing)?|crack(?:ed)?|scratch|scuff|stain|out of order|malfunction(?:ing)?)\b/i,
  /\b(?:lights?|power)\s+(?:are\s+)?out\b/i,
];

const knowledgeRetrievalRules: Record<string, RegExp[]> = {
  electrical_safety: [
    ...criticalSafetyRules,
  ],
  water_leak: [
    /\b(?:water|pipe|ceiling)\b.{0,40}\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?)\b/i,
    /\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?)\b.{0,40}\b(?:water|pipe|ceiling)\b/i,
    /\b(?:faucet|tap|toilet|drain|sink|sewage)\b/i,
  ],
  air_conditioning: classificationRules.air_conditioning,
  routine_repair: [/\b(?:loose|wobbly)\s+(?:door\s+)?handle\b/i],
  lighting: [
    /\b(?:flicker(?:s|ed|ing)?)\b.{0,20}\b(?:light|lights)\b/i,
    /\b(?:light|lights)\b.{0,20}\b(?:flicker(?:s|ed|ing)?|out)\b/i,
  ],
  water_and_electricity: [
    /\b(?:water|wet\s+(?:patch|area|floor|spot))\b.{0,120}\b(?:near|close\s+to|beside|next\s+to|around|by|on|inside)\b.{0,40}\b(?:outlet|socket|power\s+strip|electrical\s+equipment|wire|breaker|panel)\b/i,
    /\b(?:outlet|socket|power\s+strip|electrical\s+equipment|wire|breaker|panel)\b.{0,120}\b(?:near|close\s+to|beside|next\s+to|surrounded\s+by|in)\b.{0,40}\b(?:water|wet\s+(?:patch|area|floor|spot))\b/i,
  ],
};

type KnowledgeRecord = (typeof maintenanceKnowledge.records)[number];

function retrieveKnowledge(text: string, ambiguous: boolean): KnowledgeRecord[] {
  return maintenanceKnowledge.records.filter((record) => {
    if (record.topic === "unclear_report") {
      return ambiguous || !hasReportedMatch(text, issueRules);
    }

    if (record.topic === "electrical_safety") {
      return hasReportedMatch(text, criticalSafetyRules) ||
        (hasReportedMatch(text, [/\bburning\s+(?:smell|odor|odour)\b/i]) &&
          hasMatch(text, criticalElectricalContext));
    }

    const rules = knowledgeRetrievalRules[record.topic] ?? [];
    return hasReportedMatch(text, rules);
  });
}

function hasMatch(text: string, rules: RegExp[]): boolean {
  return rules.some((rule) => rule.test(text));
}

function hasReportedMatch(text: string, rules: RegExp[]): boolean {
  return rules.some((rule) => {
    const globalRule = new RegExp(rule.source, `${rule.flags.replace(/[gy]/g, "")}g`);

    for (const match of text.matchAll(globalRule)) {
      const prefix = text.slice(Math.max(0, (match.index ?? 0) - 100), match.index);
      const negation = prefix.match(/\b(?:no|without|not|never|doesn't|does not|don't|do not|isn't|is not|aren't|are not)\b([^.!?]*)$/i);
      const negatedTerms = /\b(?:fire|smoke|sparks?|sparking|burning|smell|odor|odour|exposed|live|electrical|wires?|wiring|water|leaks?|flood(?:ing|ed)?|gas\s+(?:leak|smell)|injur(?:y|ed)|one\s+(?:is|are)|person\s+(?:is|was)|people\s+(?:are|were))\b/gi;
      const remainder = negation?.[1]
        .replace(negatedTerms, "")
        .replace(/\b(?:and|or|any|visible|reported)\b/gi, "")
        .replace(/[\s,;:()-]/g, "");
      const negatesIndicator = negation !== null && remainder === "";

      if (!negatesIndicator) {
        return true;
      }
    }

    return false;
  });
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    service: "campus-maintenance-api",
  });
});

app.post("/api/maintenance-requests/decision", async (c) => {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return c.json({ success: false, error: "Request body must not exceed 16 KB" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json({ success: false, error: "Request body must be valid JSON" }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ success: false, error: "Request body must be a JSON object" }, 400);
  }

  const fields = body as Record<string, unknown>;
  const limits = { title: 200, description: 5000, location: 300 } as const;
  const cleaned: Record<keyof typeof limits, string> = {
    title: "",
    description: "",
    location: "",
  };

  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = fields[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return c.json({ success: false, error: `${field} must be a non-empty string`, field }, 400);
    }

    const trimmed = value.trim();
    if (trimmed.length > limits[field]) {
      return c.json(
        {
          success: false,
          error: `${field} must not exceed ${limits[field]} characters`,
          field,
          max_length: limits[field],
        },
        400
      );
    }

    cleaned[field] = trimmed;
  }

  const text = `${cleaned.title}\n${cleaned.description}\n${cleaned.location}`;
  const matchedCategories = (Object.keys(classificationRules) as (keyof typeof classificationRules)[])
    .filter((matchedCategory) => hasReportedMatch(text, classificationRules[matchedCategory]));
  const ambiguous = matchedCategories.length > 1;
  const knowledge = retrieveKnowledge(text, ambiguous);
  const waterSafety = knowledge.find((record) => record.topic === "water_and_electricity");
  const electricalSafety = knowledge.find((record) => record.topic === "electrical_safety");
  const criticalRecord = waterSafety ?? electricalSafety;
  const criticalHazard = criticalRecord !== undefined;
  const unclear = !hasReportedMatch(text, issueRules);
  // Electrical hazard guidance wins over routine issue matches; otherwise retrieved topic records provide category and urgency context.
  const matchedKnowledge = criticalRecord ?? knowledge.find((record) =>
    matchedCategories.includes(record.category as Exclude<DecisionCategory, "other">)
  ) ?? knowledge.find((record) => record.topic === "routine_repair");
  const category: DecisionCategory = criticalRecord?.category ??
    (ambiguous ? "other" : matchedKnowledge?.category ?? matchedCategories[0] ?? "other");
  const safetyConcern = criticalHazard || hasReportedMatch(text, safetyConcernRules);

  let urgencyScore = 1;
  let urgencyLevel: UrgencyLevel = "low";
  let needsHumanReview = false;

  if (criticalRecord) {
    urgencyScore = criticalRecord.urgency_score_guidance;
    urgencyLevel = "critical";
    needsHumanReview = criticalRecord.human_review_required;
  } else if (safetyConcern || hasReportedMatch(text, highUrgencyRules)) {
    const leakGuidance = knowledge.find((record) => record.topic === "water_leak");
    urgencyScore = leakGuidance?.urgency_score_guidance ?? 3;
    urgencyLevel = "high";
    needsHumanReview = true;
  } else if (ambiguous || unclear) {
    const unclearGuidance = knowledge.find((record) => record.topic === "unclear_report");
    urgencyScore = unclearGuidance?.urgency_score_guidance ?? 0;
    urgencyLevel = "unknown";
    needsHumanReview = unclearGuidance?.human_review_required ?? true;
  } else if (matchedKnowledge?.topic === "air_conditioning") {
    const notCooling = hasReportedMatch(text, [/\b(?:not cooling|doesn't cool|does not cool|no cool air)\b/i]);
    urgencyScore = notCooling ? matchedKnowledge.urgency_score_guidance : 1;
    urgencyLevel = notCooling ? "moderate" : "low";
    needsHumanReview = matchedKnowledge.human_review_required;
  } else if (matchedKnowledge) {
    urgencyScore = matchedKnowledge.urgency_score_guidance;
    urgencyLevel = urgencyScore === 2 ? "moderate" : urgencyScore === 1 ? "low" : "unknown";
    needsHumanReview = matchedKnowledge.human_review_required;
  } else if (hasReportedMatch(text, [/\b(?:not working|does not work|doesn't work|stopped working|broken|damaged|clogged|blocked)\b/i])) {
    urgencyScore = 2;
    urgencyLevel = "moderate";
  }

  return c.json({
    success: true,
    recommendation: {
      category,
      urgency_score: urgencyScore,
      urgency_level: urgencyLevel,
      needs_human_review: needsHumanReview || safetyConcern || ambiguous || unclear || urgencyScore >= 3,
    },
    decision_source: "fallback",
    method: "deterministic_rules",
    fallback_used: true,
  });
});

app.post("/api/maintenance-requests", async (c) => {
  const body = await c.req.json<{
    student_id: string;
    title: string;
    description: string;
    location: string;
    priority?: string;
  }>();

  if (
    !body.student_id ||
    !body.title ||
    !body.description ||
    !body.location
  ) {
    return c.json(
      {
        error:
          "student_id, title, description, and location are required",
      },
      400
    );
  }

  const result = await c.env.DB
    .prepare(`
      INSERT INTO maintenance_requests
      (student_id, title, description, location, priority)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `)
    .bind(
      body.student_id,
      body.title,
      body.description,
      body.location,
      body.priority ?? "medium"
    )
    .first();

  return c.json(result, 201);
});

app.get("/api/maintenance-requests", async (c) => {
  const { results } = await c.env.DB
    .prepare(`
      SELECT *
      FROM maintenance_requests
      ORDER BY id DESC
    `)
    .all();

  return c.json(results);
});

app.get("/api/maintenance-requests/:id", async (c) => {
  const id = c.req.param("id");

  const request = await c.env.DB
    .prepare(`
      SELECT *
      FROM maintenance_requests
      WHERE id = ?
    `)
    .bind(id)
    .first();

  if (!request) {
    return c.json(
      {
        error: "Maintenance request not found",
      },
      404
    );
  }

  return c.json(request);
});

app.patch("/api/maintenance-requests/:id", async (c) => {
  const id = c.req.param("id");

  const body = await c.req.json<{
    title?: string;
    description?: string;
    location?: string;
    priority?: string;
    status?: string;
  }>();

  const existing = await c.env.DB
    .prepare(`
      SELECT *
      FROM maintenance_requests
      WHERE id = ?
    `)
    .bind(id)
    .first();

  if (!existing) {
    return c.json(
      {
        error: "Maintenance request not found",
      },
      404
    );
  }

  const result = await c.env.DB
    .prepare(`
      UPDATE maintenance_requests
      SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        location = COALESCE(?, location),
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *
    `)
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.location ?? null,
      body.priority ?? null,
      body.status ?? null,
      id
    )
    .first();

  return c.json(result);
});

app.delete("/api/maintenance-requests/:id", async (c) => {
  const id = c.req.param("id");

  const result = await c.env.DB
    .prepare(`
      DELETE FROM maintenance_requests
      WHERE id = ?
      RETURNING *
    `)
    .bind(id)
    .first();

  if (!result) {
    return c.json(
      {
        error: "Maintenance request not found",
      },
      404
    );
  }

  return c.body(null, 204);
});

export default app;
