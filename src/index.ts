import { Hono } from "hono";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    service: "campus-maintenance-api",
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

export default app;
