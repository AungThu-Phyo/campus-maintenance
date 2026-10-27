import { Hono } from "hono";

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
    /\b(?:light|lights)\b.{0,20}\b(?:flicker(?:ing)?|out)\b/i,
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
  /\b(?:leak(?:ing)?|drip(?:ping)?|burst|flood(?:ing)?|broken|not working|does not work|doesn't work|won't work|stopped working|faulty|damaged|loose|jammed|clogged|blocked|flicker(?:ing)?|not cooling|no cool air|overheat(?:ing)?|crack(?:ed)?|scratch|scuff|stain|out of order|malfunction(?:ing)?)\b/i,
  /\b(?:lights?|power)\s+(?:are\s+)?out\b/i,
];

function hasMatch(text: string, rules: RegExp[]): boolean {
  return rules.some((rule) => rule.test(text));
}

function hasReportedMatch(text: string, rules: RegExp[]): boolean {
  return rules.some((rule) => {
    const globalRule = new RegExp(rule.source, `${rule.flags.replace(/[gy]/g, "")}g`);

    for (const match of text.matchAll(globalRule)) {
      const prefix = text.slice(Math.max(0, (match.index ?? 0) - 45), match.index);
      const negatesIndicator = /\b(?:no|not|without|never|doesn't|does not|don't|do not|isn't|is not|aren't|are not)\s+(?:(?:any|visible|reported)\s+)?(?:[a-z]+\s+){0,3}$/i.test(prefix);

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
    .filter((category) => hasMatch(text, classificationRules[category]));
  const ambiguous = matchedCategories.length > 1;
  const category: DecisionCategory = ambiguous
    ? "other"
    : matchedCategories[0] ?? "other";

  // Critical hazards override ordinary urgency rules; burning odors are critical when electrical equipment is mentioned.
  const criticalHazard = hasReportedMatch(text, criticalSafetyRules) ||
    (hasReportedMatch(text, [/\bburning\s+(?:smell|odor|odour)\b/i]) &&
      hasMatch(text, criticalElectricalContext));
  // Any other detected safety concern is escalated for a person; keyword matches never certify that a situation is safe.
  const safetyConcern = criticalHazard || hasReportedMatch(text, safetyConcernRules);
  const unclear = !hasReportedMatch(text, issueRules);

  let urgencyScore = 1;
  let urgencyLevel: UrgencyLevel = "low";

  if (criticalHazard) {
    urgencyScore = 4;
    urgencyLevel = "critical";
  } else if (safetyConcern || hasReportedMatch(text, highUrgencyRules)) {
    urgencyScore = 3;
    urgencyLevel = "high";
  } else if (unclear) {
    urgencyScore = 0;
    urgencyLevel = "unknown";
  } else if (/\b(?:air conditioning|air conditioner|a\/c|ac(?: unit)?|hvac)\b.{0,40}\b(?:not cooling|doesn't cool|does not cool|no cool air)\b/i.test(text) ||
    /\b(?:not cooling|doesn't cool|does not cool|no cool air)\b.{0,40}\b(?:air conditioning|air conditioner|a\/c|ac(?: unit)?|hvac)\b/i.test(text)) {
    urgencyScore = 2;
    urgencyLevel = "moderate";
  } else if (/\b(?:loose|wobbly)\s+(?:door\s+)?handle\b/i.test(text)) {
    urgencyScore = 1;
    urgencyLevel = "low";
  } else if (/\b(?:minor|cosmetic)\s+(?:scratch|scuff|stain|paint damage)\b/i.test(text)) {
    urgencyScore = 0;
    urgencyLevel = "low";
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
      needs_human_review: safetyConcern || ambiguous || unclear || urgencyScore >= 3,
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
