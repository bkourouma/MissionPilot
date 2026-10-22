import { z } from "zod";
import { ErreurIngestion } from "./erreurs.js";

/*
 * Port de reconnaissance de caractères (OCR) de l'ingestion (ADR-009, décision 4).
 *
 * AUCUN moteur OCR réel n'est branché : un seul adaptateur est livré, `OcrSimule`, réservé au
 * développement et aux tests. Il ne lit qu'un CONTENEUR DE TEST : un commentaire de PDF
 * `%MPOCRSIM1:<base64 d'un JSON {pages:[{numero,texte,confiance_pm}]}>`. Tout autre document est
 * refusé (`OCR_NON_SIMULE`) : aucune page réelle ne peut donc être « reconnue ». Une page reconnue
 * porte une confiance (0 à 1000) et ne donne JAMAIS d'acceptation automatique d'un état financier.
 */

export const MARQUEUR_OCR_SIMULE = "%MPOCRSIM1:";
/** Taille maximale de la charge base64 lue (garde-fou : le PDF est déjà plafonné à 10 Mo). */
const CHARGE_BASE64_MAX = 2 * 1024 * 1024;

export interface PageOcr {
  numero: number;
  texte: string;
  /** Confiance de la lecture, de 0 à 1000 (millièmes). */
  confiance_pm: number;
}

export interface Ocr {
  readonly fournisseur: string;
  readonly mode: "simule";
  /** Lit les pages demandées (numéros à partir de 1) ; une page absente du résultat n'a pas été lue. */
  reconnaitre(demande: { pdf: Buffer; pages: number[] }): Promise<PageOcr[]>;
}

const chargeSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            numero: z.number().int().min(1).max(200),
            texte: z.string().max(30_000),
            confiance_pm: z.number().int().min(0).max(1000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export class OcrSimule implements Ocr {
  readonly fournisseur = "simule";
  readonly mode = "simule" as const;

  async reconnaitre(demande: { pdf: Buffer; pages: number[] }): Promise<PageOcr[]> {
    const brut = demande.pdf.toString("latin1");
    const debut = brut.indexOf(MARQUEUR_OCR_SIMULE);
    if (debut < 0) throw new ErreurIngestion("OCR_NON_SIMULE");
    let fin = debut + MARQUEUR_OCR_SIMULE.length;
    while (fin < brut.length && /[A-Za-z0-9+/=_-]/.test(brut[fin] as string)) {
      fin += 1;
      if (fin - debut > CHARGE_BASE64_MAX) throw new ErreurIngestion("OCR_NON_SIMULE");
    }
    let charge: z.infer<typeof chargeSchema>;
    try {
      const base64 = brut.slice(debut + MARQUEUR_OCR_SIMULE.length, fin);
      charge = chargeSchema.parse(JSON.parse(Buffer.from(base64, "base64").toString("utf8")));
    } catch {
      throw new ErreurIngestion("OCR_NON_SIMULE");
    }
    const demandees = new Set(demande.pages);
    return charge.pages.filter((p) => demandees.has(p.numero));
  }
}
