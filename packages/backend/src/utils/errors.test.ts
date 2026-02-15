import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from "./errors.js";

describe("Error Classes", () => {
  describe("AppError", () => {
    it("has default statusCode 500", () => {
      const error = new AppError("Something went wrong");
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe("Something went wrong");
      expect(error.code).toBeUndefined();
    });

    it("accepts custom statusCode and code", () => {
      const error = new AppError("Custom error", 418, "TEAPOT");
      expect(error.statusCode).toBe(418);
      expect(error.code).toBe("TEAPOT");
      expect(error.message).toBe("Custom error");
    });

    it("is instanceof Error", () => {
      const error = new AppError("Test");
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("NotFoundError", () => {
    it("has 404 status and NOT_FOUND code", () => {
      const error = new NotFoundError("Server", "abc123");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    });

    it("message includes resource and id", () => {
      const error = new NotFoundError("Server", "abc123");
      expect(error.message).toContain("Server");
      expect(error.message).toContain("abc123");
      expect(error.message).toBe("Server with id 'abc123' not found");
    });

    it("is instanceof AppError", () => {
      const error = new NotFoundError("Server", "abc123");
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("ValidationError", () => {
    it("has 400 status and VALIDATION_ERROR code", () => {
      const error = new ValidationError("Invalid input");
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Invalid input");
    });

    it("is instanceof AppError", () => {
      const error = new ValidationError("Test");
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("ConflictError", () => {
    it("has 409 status and CONFLICT code", () => {
      const error = new ConflictError("Resource already exists");
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe("CONFLICT");
      expect(error.message).toBe("Resource already exists");
    });

    it("is instanceof AppError", () => {
      const error = new ConflictError("Test");
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("UnauthorizedError", () => {
    it("has 401 status and UNAUTHORIZED code", () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
    });

    it("has default message", () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe("Authentication required");
    });

    it("accepts custom message", () => {
      const error = new UnauthorizedError("Invalid token");
      expect(error.message).toBe("Invalid token");
    });

    it("is instanceof AppError", () => {
      const error = new UnauthorizedError();
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("ForbiddenError", () => {
    it("has 403 status and FORBIDDEN code", () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("FORBIDDEN");
    });

    it("has default message", () => {
      const error = new ForbiddenError();
      expect(error.message).toBe("Insufficient permissions");
    });

    it("accepts custom message", () => {
      const error = new ForbiddenError("Admin only");
      expect(error.message).toBe("Admin only");
    });

    it("is instanceof AppError", () => {
      const error = new ForbiddenError();
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });
});
