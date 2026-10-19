declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    PLANNER_KEY_HASH?: string;
    BUCKET?: R2Bucket;
  }
}
