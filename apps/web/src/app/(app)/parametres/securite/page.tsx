import type { Metadata } from "next";
import { ROLE_LIBELLES } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { PolitiqueTfa } from "../../../../lib/double-authentification";
import { exigerPermission } from "../../../../lib/session";
import { FormulairePolitiqueTfa } from "./FormulairePolitiqueTfa";

export const metadata: Metadata = { title: "Sécurité du cabinet" };

export default async function PageSecuriteCabinet() {
  await exigerPermission("cabinet.gerer");
  const r = await chargerServeur<PolitiqueTfa>("/api/auth/2fa/politique");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Sécurité"
        soustitre="Politique de double authentification du cabinet. Chaque personne l'active depuis « Sécurité du compte » ; un associé peut la réinitialiser (téléphone perdu) depuis la liste des utilisateurs."
      />
      <Carte titre="Double authentification obligatoire">
        {!r.ok ? (
          <EtatErreur
            titre="La politique n'a pas pu être chargée."
            message={r.message}
            hrefReessayer="/parametres/securite"
          />
        ) : (
          <div className="mp-pile">
            {r.donnees.plancher_plateforme ? (
              <p className="mp-texte-doux">
                La plateforme impose déjà la double authentification aux rôles :{" "}
                {r.donnees.roles_obligatoires_effectifs.map((x) => ROLE_LIBELLES[x]).join(", ")}.
              </p>
            ) : null}
            <FormulairePolitiqueTfa politique={r.donnees} />
          </div>
        )}
      </Carte>
    </div>
  );
}
