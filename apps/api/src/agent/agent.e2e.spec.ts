import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { AgentModule } from "./agent.module";
import { PrismaService } from "../prisma/prisma.service";
import { AllExceptionsFilter } from "../common";
import { apiKeyDisplayPrefix, hashApiKey } from "./services/api-key.service";

const rawToken = "pxl_live_abcdefghijklmnopqrstuvwxyz012345";
const orgId = "org_e2e";

describe("Agent API e2e", () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: FakePrisma;

  beforeAll(async () => {
    db = new FakePrisma();
    db.apiKeys.push({
      id: "api_key_1",
      organizationId: orgId,
      name: "Omni Agent",
      keyHash: hashApiKey(rawToken),
      keyPrefix: apiKeyDisplayPrefix(rawToken),
      scopes: ["projects:write", "projects:read", "tasks:write", "tasks:read", "deliverables:write", "audit:read"],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: null,
    });
    db.projectStatuses.push({ organizationId: orgId, slug: "not_started" });
    db.members.push({ organizationId: orgId, userId: "user_1" });

    const moduleRef = await Test.createTestingModule({ imports: [LoggerModule.forRoot(), AgentModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix("api");
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the happy path with audit and idempotency", async () => {
    const projectCreate = await request("/api/agent/projects", "POST", {
      name: "Agent Build",
      externalId: "linear:PXL-5",
    });
    expect(projectCreate.status).toBe(201);
    const projectBody = await projectCreate.json();
    expect(projectBody.ok).toBe(true);
    expect(projectBody.meta.auditEventId).toBe("audit_1");
    expect(db.auditEvents.length).toBe(1);

    const projectRetry = await request("/api/agent/projects", "POST", {
      name: "Agent Build Mutated",
      externalId: "linear:PXL-5",
    });
    expect(projectRetry.status).toBe(200);
    expect(db.auditEvents.length).toBe(1);

    const projectId = projectBody.data.id;
    const taskCreate = await request("/api/agent/tasks", "POST", {
      projectId,
      title: "Wire endpoints",
      externalId: "task:1",
      clientVisible: true,
    });
    expect(taskCreate.status).toBe(201);
    const taskBody = await taskCreate.json();
    expect(taskBody.meta.auditEventId).toBe("audit_2");

    const taskPatch = await request(`/api/agent/tasks/${taskBody.data.id}`, "PATCH", { status: "done" });
    expect(taskPatch.status).toBe(200);
    const patchedTask = await taskPatch.json();
    expect(patchedTask.data.completedAt).toBeTruthy();
    expect(db.auditEvents[2].action).toBe("status_changed");

    const deliverableCreate = await request(`/api/agent/tasks/${taskBody.data.id}/deliverables`, "POST", {
      title: "Build doc",
      url: "https://example.com/build-doc",
    });
    expect(deliverableCreate.status).toBe(201);
    expect(db.auditEvents.length).toBe(4);

    const commentCreate = await request("/api/agent/comments", "POST", {
      taskId: taskBody.data.id,
      body: "Wired and verified.",
      externalId: "comment:1",
    });
    expect(commentCreate.status).toBe(201);
    const commentRetry = await request("/api/agent/comments", "POST", {
      taskId: taskBody.data.id,
      body: "Duplicate body ignored.",
      externalId: "comment:1",
    });
    expect(commentRetry.status).toBe(200);

    const updateCreate = await request("/api/agent/project-updates", "POST", {
      projectId,
      title: "Phase 1 complete",
      body: "Agent endpoints are online.",
      externalId: "update:1",
    });
    expect(updateCreate.status).toBe(201);

    const noteCreate = await request("/api/agent/project-notes", "POST", {
      projectId,
      body: "Internal implementation note.",
      externalId: "note:1",
    });
    expect(noteCreate.status).toBe(201);

    const commentsList = await request(`/api/agent/comments?taskId=${taskBody.data.id}`, "GET");
    expect(commentsList.status).toBe(200);
    const commentsBody = await commentsList.json();
    expect(commentsBody.data.items.length).toBe(1);

    expect(db.auditEvents.length).toBe(7);

    const audit = await request("/api/agent/audit", "GET");
    expect(audit.status).toBe(200);
    const auditBody = await audit.json();
    expect(auditBody.data.items.length).toBe(7);
    expect(auditBody.data.items.map((event: { action: string }) => event.action)).toContain("status_changed");
  });

  async function request(path: string, method: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "Content-Type": "application/json",
        "x-request-id": "test-request",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
});

class FakePrisma {
  apiKeys: any[] = [];
  projects: any[] = [];
  tasks: any[] = [];
  taskDeliverables: any[] = [];
  comments: any[] = [];
  projectUpdates: any[] = [];
  projectNotes: any[] = [];
  auditEvents: any[] = [];
  members: any[] = [];
  projectStatuses: any[] = [];

  apiKey = {
    findUnique: async ({ where }: any) => this.apiKeys.find((key) => key.keyHash === where.keyHash) ?? null,
    update: async ({ where, data }: any) => this.updateOne(this.apiKeys, where.id, data),
  };

  projectStatus = {
    findFirst: async ({ where }: any) => this.projectStatuses.find((status) => status.organizationId === where.organizationId && status.slug === where.slug) ?? null,
  };

  member = {
    findFirst: async ({ where }: any) => this.members.find((member) => member.organizationId === where.organizationId && member.userId === where.userId) ?? null,
  };

  project = {
    findFirst: async ({ where }: any) => this.projects.find((project) => matches(project, where)) ?? null,
    create: async ({ data, include }: any) => {
      const project = withTimestamps({ id: `project_${this.projects.length + 1}`, status: "not_started", clients: [], ...data });
      if (data.clients?.create) project.clients = data.clients.create.map((client: any) => ({ userId: client.userId }));
      this.projects.push(project);
      return includeProject(project, include);
    },
    update: async ({ where, data, include }: any) => {
      const project = this.projects.find((item) => item.id === where.id);
      if (!project) throw new Error("missing project");
      Object.assign(project, data, { updatedAt: new Date() });
      if (data.clients?.create) project.clients = data.clients.create.map((client: any) => ({ userId: client.userId }));
      return includeProject(project, include);
    },
    findMany: async ({ where, take }: any) => this.projects.filter((project) => matches(project, where)).slice(0, take),
  };

  projectClient = {
    deleteMany: async ({ where }: any) => {
      const project = this.projects.find((item) => item.id === where.projectId);
      if (project) project.clients = [];
      return { count: project ? 1 : 0 };
    },
  };

  task = {
    findFirst: async ({ where }: any) => this.tasks.find((task) => matches(task, where)) ?? null,
    aggregate: async ({ where }: any) => ({ _max: { order: Math.max(-1, ...this.tasks.filter((task) => matches(task, where)).map((task) => task.order)) } }),
    create: async ({ data }: any) => {
      const task = withTimestamps({ id: `task_${this.tasks.length + 1}`, status: "open", ...data, completedAt: null });
      this.tasks.push(task);
      return task;
    },
    update: async ({ where, data }: any) => {
      const task = this.tasks.find((item) => item.id === where.id);
      if (!task) throw new Error("missing task");
      Object.assign(task, data, { updatedAt: new Date() });
      return task;
    },
    groupBy: async ({ where }: any) => {
      const counts = new Map<string, number>();
      for (const task of this.tasks.filter((item) => matches(item, where))) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
      return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { _all: count } }));
    },
  };

  file = { findFirst: async () => null };

  taskDeliverable = {
    findFirst: async ({ where }: any) => this.taskDeliverables.find((deliverable) => matches(deliverable, where)) ?? null,
    create: async ({ data }: any) => {
      const deliverable = withTimestamps({ id: `deliverable_${this.taskDeliverables.length + 1}`, ...data });
      this.taskDeliverables.push(deliverable);
      return deliverable;
    },
  };

  comment = {
    findFirst: async ({ where }: any) => this.comments.find((comment) => matches(comment, where)) ?? null,
    findMany: async ({ where, take }: any) => this.comments.filter((comment) => matches(comment, where)).slice(0, take),
    create: async ({ data }: any) => {
      const comment = withTimestamps({ id: `comment_${this.comments.length + 1}`, ...data });
      this.comments.push(comment);
      return comment;
    },
    update: async ({ where, data }: any) => {
      const comment = this.comments.find((item) => item.id === where.id);
      if (!comment) throw new Error("missing comment");
      Object.assign(comment, data, { updatedAt: new Date() });
      return comment;
    },
  };

  projectUpdate = {
    findFirst: async ({ where }: any) => this.projectUpdates.find((update) => matches(update, where)) ?? null,
    findMany: async ({ where, take }: any) => this.projectUpdates.filter((update) => matches(update, where)).slice(0, take),
    create: async ({ data }: any) => {
      const update = withTimestamps({ id: `project_update_${this.projectUpdates.length + 1}`, ...data });
      this.projectUpdates.push(update);
      return update;
    },
    update: async ({ where, data }: any) => {
      const update = this.projectUpdates.find((item) => item.id === where.id);
      if (!update) throw new Error("missing project update");
      Object.assign(update, data, { updatedAt: new Date() });
      return update;
    },
  };

  projectNote = {
    findFirst: async ({ where }: any) => this.projectNotes.find((note) => matches(note, where)) ?? null,
    findMany: async ({ where, take }: any) => this.projectNotes.filter((note) => matches(note, where)).slice(0, take),
    create: async ({ data }: any) => {
      const note = withTimestamps({ id: `project_note_${this.projectNotes.length + 1}`, ...data });
      this.projectNotes.push(note);
      return note;
    },
    update: async ({ where, data }: any) => {
      const note = this.projectNotes.find((item) => item.id === where.id);
      if (!note) throw new Error("missing project note");
      Object.assign(note, data, { updatedAt: new Date() });
      return note;
    },
  };

  auditEvent = {
    create: async ({ data }: any) => {
      const event = { id: `audit_${this.auditEvents.length + 1}`, createdAt: new Date(), ...data };
      this.auditEvents.push(event);
      return event;
    },
    findMany: async ({ where, take }: any) => this.auditEvents.filter((event) => matches(event, where)).reverse().slice(0, take),
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private updateOne(rows: any[], id: string, data: any) {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error(`row not found: ${id}`);
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
}

function withTimestamps<T extends Record<string, unknown>>(row: T): T {
  const now = new Date();
  return { createdAt: now, updatedAt: now, ...row };
}

function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === "clients") return row.clients?.some((client: any) => client.userId === (value as any).some.userId);
    if (key === "createdAt") return true;
    if (value && typeof value === "object" && "lt" in value) return row[key] < (value as any).lt;
    return row[key] === value;
  });
}

function includeProject(project: any, include: any) {
  if (!include?.clients) return project;
  return { ...project, clients: project.clients ?? [] };
}
