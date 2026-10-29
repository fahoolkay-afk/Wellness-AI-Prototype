import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Clinic } from "../types.ts";
import type { PracticeBackend } from "./backend.ts";
import { BuiltinBackend } from "./builtin.ts";
import { EhrBackend, EhrClient } from "./ehr.ts";
import { JaneLinkBackend } from "./jane.ts";

export interface Backends {
  forClinic(clinic: Clinic): PracticeBackend;
  /** Present only in the EHR-connected edition. */
  ehr?: EhrBackend;
}

export function createBackends(db: Db, config: Config, fetchImpl?: typeof fetch): Backends {
  const builtin = new BuiltinBackend(db);
  const jane = new JaneLinkBackend(db);
  let ehr: EhrBackend | undefined;
  if (config.edition === "ehr") {
    if (!config.ehr.baseUrl) throw new Error("EDITION=ehr requires EHR_BASE_URL (run `npm run ehr:mock` for a local test EHR).");
    ehr = new EhrBackend(db, new EhrClient({ baseUrl: config.ehr.baseUrl, apiKey: config.ehr.apiKey, timeoutMs: config.ehr.timeoutMs, fetchImpl }));
  }
  return {
    ehr,
    forClinic(clinic) {
      if (ehr) return ehr;
      return clinic.profile.bookingProvider === "jane" ? jane : builtin;
    },
  };
}
