import type { ContexteTenantDemo } from "../contexte.js";
import { etape } from "./commun.js";
import { semerDdDossiers } from "./dd-dossiers.js";
import { semerDdNotes } from "./dd-notes.js";

/* Due diligence (missions 4 et 11) : dossiers et analyses, puis notes et portail investisseur. */
export async function semerDueDiligence(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "dd-dossiers", () => semerDdDossiers(ctx));
  await etape(ctx, "dd-notes", () => semerDdNotes(ctx));
}
