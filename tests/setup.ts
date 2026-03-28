import "dotenv/config";

/** Deterministic tests: no ML server required for train/forecast mock path */
process.env.ML_SERVICE_URL = "";

/** Integration tests call POST /auth/register — re-enable for test runs only */
process.env.ALLOW_PUBLIC_REGISTRATION = "true";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  process.env.JWT_SECRET = "test-jwt-secret-for-integration-tests-only";
}
