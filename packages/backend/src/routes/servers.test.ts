import supertest from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "../app.js";
import { setupTestDb, teardownTestDb } from "../test-utils/db.js";
import {
  createTestOwner,
  createTestUser,
  type TestUser,
} from "../test-utils/auth.js";
import { buildCreateServerRequest } from "../test-utils/factories.js";
import { invalidateUserCountCache } from "../middleware/auth.js";

let owner: TestUser;
let tempServersDir: string;

beforeAll(() => {
  tempServersDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-servers-"));
  process.env.SERVERS_DIR = tempServersDir;

  setupTestDb();
  owner = createTestOwner();
  // Auth middleware caches user count; creating a user means multi-user mode
  // is now active, so invalidate to ensure auth is enforced correctly.
  invalidateUserCountCache();
});

afterAll(() => {
  teardownTestDb();
  if (tempServersDir && fs.existsSync(tempServersDir)) {
    fs.rmSync(tempServersDir, { recursive: true, force: true });
  }
});

describe("GET /api/servers", () => {
  it("returns 200 with an empty array when no servers exist", async () => {
    const res = await supertest(app)
      .get("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/servers", () => {
  it("creates a server and returns 201 with server data", async () => {
    const body = buildCreateServerRequest({
      name: "Integration Test Server",
      port: 25570,
    });

    const res = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Integration Test Server",
      type: "vanilla",
      mcVersion: "1.21",
      port: 25570,
    });
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.id).toBe("string");
  });

  it("returns 400 when name is missing", async () => {
    const res = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "vanilla", mcVersion: "1.21" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when port is below 1024", async () => {
    const body = buildCreateServerRequest({ port: 80 });

    const res = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when port is above 65535", async () => {
    const body = buildCreateServerRequest({ port: 70000 });

    const res = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when port is not an integer", async () => {
    const res = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        name: "Bad Port Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565.5,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when port is already in use by another server", async () => {
    const body1 = buildCreateServerRequest({
      name: "Port Conflict A",
      port: 25580,
    });
    const res1 = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body1);
    expect(res1.status).toBe(201);

    const body2 = buildCreateServerRequest({
      name: "Port Conflict B",
      port: 25580,
    });
    const res2 = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body2);
    expect(res2.status).toBe(409);
  });
});

describe("GET /api/servers/:id", () => {
  it("returns 200 with server data for a valid id", async () => {
    const body = buildCreateServerRequest({
      name: "Get By ID Server",
      port: 25571,
    });
    const createRes = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);
    const serverId = createRes.body.id;

    const res = await supertest(app)
      .get(`/api/servers/${serverId}`)
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: serverId,
      name: "Get By ID Server",
      port: 25571,
      status: "stopped",
      playerCount: 0,
    });
  });

  it("returns 404 for a nonexistent server id", async () => {
    const res = await supertest(app)
      .get("/api/servers/nonexistent-id-123")
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/servers/:id", () => {
  it("updates a server name and returns 200", async () => {
    const body = buildCreateServerRequest({
      name: "Before Update",
      port: 25572,
    });
    const createRes = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);
    const serverId = createRes.body.id;

    const res = await supertest(app)
      .patch(`/api/servers/${serverId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "After Update" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("After Update");
    expect(res.body.id).toBe(serverId);
  });

  it("returns 400 for invalid port in update", async () => {
    const body = buildCreateServerRequest({
      name: "Patch Invalid Port",
      port: 25573,
    });
    const createRes = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);
    const serverId = createRes.body.id;

    const res = await supertest(app)
      .patch(`/api/servers/${serverId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ port: 999 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent server", async () => {
    const res = await supertest(app)
      .patch("/api/servers/nonexistent-id-123")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Nope" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/servers/:id", () => {
  it("deletes a server and returns 204", async () => {
    const body = buildCreateServerRequest({
      name: "To Be Deleted",
      port: 25574,
    });
    const createRes = await supertest(app)
      .post("/api/servers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send(body);
    const serverId = createRes.body.id;

    const res = await supertest(app)
      .delete(`/api/servers/${serverId}`)
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(204);

    const getRes = await supertest(app)
      .get(`/api/servers/${serverId}`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for nonexistent server", async () => {
    const res = await supertest(app)
      .delete("/api/servers/nonexistent-id-123")
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(404);
  });
});

describe("Auth enforcement", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await supertest(app).get("/api/servers");

    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is malformed", async () => {
    const res = await supertest(app)
      .get("/api/servers")
      .set("Authorization", "InvalidToken");

    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await supertest(app)
      .get("/api/servers")
      .set("Authorization", "Bearer invalid.token.here");

    expect(res.status).toBe(401);
  });

  it("allows access with a valid member token for GET /api/servers", async () => {
    const member = createTestUser({ role: "member" });

    const res = await supertest(app)
      .get("/api/servers")
      .set("Authorization", `Bearer ${member.token}`);

    expect(res.status).toBe(200);
  });
});
