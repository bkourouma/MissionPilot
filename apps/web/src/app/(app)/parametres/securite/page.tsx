import type { Metadata } from "next";
import { libelleRole } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { PolitiqueTfa } from "../../../../lib/double-authentification";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulairePolitiqueTfa } from "./FormulairePolitiqueTfa";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Sécurité du cabinet", "Firm security") };
}

export default async function PageSecuriteCabinet() {
  await exigerPermission("cabinet.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<PolitiqueTfa>("/api/auth/2fa/politique");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Sécurité", "Security")}
        soustitre={t(
          "Politique de double authentification du cabinet. Chaque personne l'active depuis « Sécurité du compte » ; un associé peut la réinitialiser (téléphone perdu) depuis la liste des utilisateurs.",
          "The firm's two-factor authentication policy. Each person turns it on from \u201cAccount security\u201d; a partner can reset it (lost phone) from the list of users.",
        )}
      />
      <Carte
        titre={t("Double authentification obligatoire", "Mandatory two-factor authentication")}
      >
        {!r.ok ? (
          <EtatErreur
            titre={t("La politique n'a pas pu être chargée.", "The policy could not be loaded.")}
            message={r.message}
            hrefReessayer="/parametres/securite"
          />
        ) : (
          <div className="mp-pile">
            {r.donnees.plancher_plateforme ? (
              <p className="mp-texte-doux">
                {t(
                  "La plateforme impose déjà la double authentification aux rôles :",
                  "The platform already requires two-factor authentication for the roles:",
                )}{" "}
                {r.donnees.roles_obligatoires_effectifs
                  .map((x) => libelleRole(x, langue))
                  .join(", ")}
                .
              </p>
            ) : null}
            <FormulairePolitiqueTfa politique={r.donnees} />
          </div>
        )}
      </Carte>
    </div>
  );
}
