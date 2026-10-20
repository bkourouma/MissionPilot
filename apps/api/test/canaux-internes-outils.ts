import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { ajouterConsentement } from "../src/canaux/consentements.js";
import { ecrireNumero } from "../src/canaux/destinataires.js";
import { proprietaire } from "./helpers.js";
import type { CabinetApi, ContexteCanaux } from "./canaux-outils.js";

/*
 * Destinataire WhatsApp d'un utilisateur INTERNE du cabinet (responsable de KPI). L'API de gestion ne
 * rattache que des utilisateurs du portail ; la base, elle, l'admet (MPH12 : utilisateur actif
 * rattachable) : le test passe donc par les fonctions du service, puis pose la vérification comme
 * `destinataireForce` (le code n'est pas reçu : numéro de la plage de test, boîte du simulateur).
 */
export async function destinataireInterne(
  ctx: ContexteCanaux,
  c: CabinetApi & { associeId: string },
  utilisateurId: string,
  numero: string,
  options: { verifie?: boolean; consentement?: boolean } = {},
): Promise<string> {
  const { verifie = true, consentement = true } = options;
  const trousseau = trousseauDepuisConfig(ctx.config);
  const id = await ctx.db.withTenant(c.cabinetId, async (db) => {
    const r = await ecrireNumero(
      db,
      { trousseau, canaux: ctx.canaux },
      {
        acteur: { cabinetId: c.cabinetId, utilisateurId: c.associeId },
        utilisateurId,
        canal: "whatsapp",
        numero,
        maintenant: new Date(),
      },
    );
    return r.destinataire.id;
  });
  if (verifie) {
    await proprietaire((cl) =>
      cl.query(
        "UPDATE canaux_destinataires SET verifie_le = now(), code_empreinte = NULL, code_expire_le = NULL WHERE id = $1",
        [id],
      ),
    );
    if (consentement) {
      await ctx.db.withTenant(c.cabinetId, (db) =>
        ajouterConsentement(db, {
          cabinetId: c.cabinetId,
          destinataireId: id,
          canal: "whatsapp",
          statut: "accorde",
          source: "recueilli_cabinet",
          acteurId: c.associeId,
          referencePreuve: "Accord écrit signé le 12/10/2026",
        }),
      );
    }
  }
  return id;
}
